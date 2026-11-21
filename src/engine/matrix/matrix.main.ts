import { Room, Session } from "../../matrix";
import { MainContext } from "../MainThread";
import { defineModule, getModule, registerMessageHandler, Thread } from "../module/module.common";
import { createDisposables } from "../utils/createDisposables";
import { createDeferred, Deferred } from "../utils/Deferred";
import {
  ClientEvent,
  MatrixMessageType,
  WidgetAction,
  WidgetAPI,
  WidgetAPIErrorResponse,
  WidgetAPIRequest,
  WidgetAPIResponse,
  WidgetContentLoadedResponse,
  WidgetMessage,
  WidgetReadEventsData,
  WidgetSendEventData,
} from "./matrix.common";
import {
  requestScriptConsent,
  SCRIPT_MESSAGE_MAX_LENGTH,
  SCRIPT_SEND_DECLINE_LIMIT,
  SCRIPT_SENDABLE_MSGTYPES,
  VIA_SCRIPT_KEY,
} from "./scriptConsent.main";

interface WidgetContext {
  widgetId: string;
  capabilities: Map<string, Set<string>>;
  outboundRequests: Map<string, Deferred<WidgetAPIResponse> | null>;
  disposeTimeline?: () => void;
}

interface MatrixModuleState {
  activeSession?: Session;
  activeRoom?: Room;
  /** Buzzar: the world's script_url as published (the key for consent). */
  activeScriptUrl?: string;
  widgets: Map<string, WidgetContext>;
  /** Buzzar: a send confirmation is open (one at a time). */
  sendPending: boolean;
  /** Buzzar: send requests the visitor declined this visit. */
  sendDeclines: number;
}

export const MatrixModule = defineModule<MainContext, MatrixModuleState>({
  name: "matrix",
  create: () => {
    return {
      widgets: new Map(),
      sendPending: false,
      sendDeclines: 0,
    };
  },
  init(ctx: MainContext) {
    return createDisposables([registerMessageHandler(ctx, MatrixMessageType.WidgetMessage, onWidgetMessage)]);
  },
});

function onWidgetMessage(ctx: MainContext, widgetMessage: WidgetMessage) {
  const matrixModule = getModule(ctx, MatrixModule);

  const message = widgetMessage.message;

  if (!message.action || !message.requestId || !message.widgetId) return;

  if (!("response" in message)) {
    if (message.api !== WidgetAPI.FromWidget) return;
    handleWidgetRequest(ctx, matrixModule, message);
  } else {
    if (message.api !== WidgetAPI.ToWidget) return;
    handleWidgetResponse(matrixModule.widgets, message);
  }
}

function getNextRequestId(widget: WidgetContext) {
  const idBase = `widgetapi-${Date.now()}`;
  let index = 0;
  let id = idBase;
  while (widget.outboundRequests.has(id)) {
    id = `${idBase}-${index++}`;
  }

  // reserve the ID
  widget.outboundRequests.set(id, null);

  return id;
}

function reply<T extends { [key: string]: unknown }>(ctx: MainContext, request: WidgetAPIRequest, responseData: T) {
  ctx.sendMessage<WidgetMessage>(Thread.Game, {
    type: MatrixMessageType.WidgetMessage,
    message: {
      ...request,
      response: responseData,
    },
  });
}

function sendComplete<T extends { [key: string]: unknown }, R extends WidgetAPIResponse>(
  ctx: MainContext,
  widget: WidgetContext,
  action: WidgetAction,
  data: T
): Promise<R> {
  const request: WidgetAPIRequest = {
    api: WidgetAPI.ToWidget,
    widgetId: widget.widgetId,
    requestId: getNextRequestId(widget),
    action,
    data,
  };

  const deferredResponse = createDeferred<R>(10 * 1000, "Request timed out.");

  widget.outboundRequests.set(request.requestId, deferredResponse);

  ctx.sendMessage<WidgetMessage>(Thread.Game, {
    type: MatrixMessageType.WidgetMessage,
    message: request,
  });

  return deferredResponse.promise.finally(() => {
    widget.outboundRequests.delete(request.requestId);
  });
}

// TODO: Don't actually export this. Just doing this to prevent linting errors
export function send<T extends { [key: string]: unknown }, R extends { [key: string]: unknown }>(
  ctx: MainContext,
  widget: WidgetContext,
  action: WidgetAction,
  data: T
): Promise<R> {
  return sendComplete<T, WidgetAPIResponse>(ctx, widget, action, data).then((r) => r.response as R);
}

function handleWidgetRequest(ctx: MainContext, matrixModule: MatrixModuleState, request: WidgetAPIRequest) {
  const { widgets } = matrixModule;

  const action = request.action;

  if (action === WidgetAction.ContentLoaded) {
    if (!widgets.has(request.widgetId)) {
      const widget: WidgetContext = {
        widgetId: request.widgetId,
        outboundRequests: new Map(),
        // Buzzar: nothing by default (Third Room silently let every script post as you and read the chat).
        capabilities: new Map(),
      };

      widgets.set(request.widgetId, widget);

      reply<WidgetContentLoadedResponse>(ctx, request, {});

      // A script that talks to Matrix wants the live chat: ask the visitor (or use their remembered answer).
      const room = matrixModule.activeRoom;
      if (room) {
        requestScriptConsent({ kind: "receive", roomId: room.id, scriptUrl: matrixModule.activeScriptUrl ?? "" }).then(
          (granted) => {
            if (!granted || matrixModule.activeRoom !== room || widgets.get(widget.widgetId) !== widget) return;
            widget.capabilities.set("m.receive.event", new Set(["m.room.message"]));
            initializeRoomEventListener(ctx, matrixModule, widget).catch((error) => console.error(error));
          }
        );
      }
    }

    return;
  }

  const widget = widgets.get(request.widgetId);

  if (!widget) return;

  switch (action) {
    case WidgetAction.SendEvent:
      return handleSendEventAction(ctx, matrixModule, widget, request);
    case WidgetAction.ReadEvents:
      return handleReadEventsAction(ctx, matrixModule, widget, request);
    default:
      return reply(ctx, request, {
        error: {
          message: "Unknown or unsupported action: " + action,
        },
      });
  }
}

function handleWidgetResponse(
  widgets: Map<string, WidgetContext>,
  response: WidgetAPIResponse | WidgetAPIErrorResponse
) {
  const widget = widgets.get(response.widgetId);

  if (!widget) return;

  const request = widget.outboundRequests.get(response.requestId);

  if (!request) return;

  if ("error" in response.response && (response.response.error as any).message) {
    request.reject(response.response.error.message);
  } else {
    request.resolve(response);
  }
}

async function initializeRoomEventListener(ctx: MainContext, matrixModule: MatrixModuleState, widget: WidgetContext) {
  const session = matrixModule.activeSession;

  if (!session) {
    throw new Error("No session set");
  }

  const room = matrixModule.activeRoom;

  if (!room) {
    throw new Error("Room not loaded yet");
  }

  const timeline = await room.openTimeline();
  // Buzzar: live messages only, never the history the timeline loads first.
  const since = Date.now() - 5000;

  const unsubscribe = timeline.onLiveEvent((event) => {
    if ((event.origin_server_ts ?? 0) >= since && widget.capabilities.get("m.receive.event")?.has(event.type)) {
      send(ctx, widget, WidgetAction.SendEvent, event as unknown as { [key: string]: unknown }).catch((error) => {
        console.error(error);
      });
    }
  });

  widget.disposeTimeline = () => {
    // The timeline itself is the room's shared one; only stop listening.
    unsubscribe();
  };
}

function handleSendEventAction(
  ctx: MainContext,
  matrixModule: MatrixModuleState,
  widget: WidgetContext,
  request: WidgetAPIRequest
) {
  const session = matrixModule.activeSession;

  if (!session) {
    throw new Error("No session set");
  }

  const room = matrixModule.activeRoom;

  if (!room) {
    throw new Error("Room not loaded yet");
  }

  const data = request.data as WidgetSendEventData;

  if (!data.type) {
    return reply(ctx, request, {
      error: {
        message: "Invalid request - missing event type",
      },
    });
  }

  const refuse = (message: string) => reply(ctx, request, { error: { message } });

  // Buzzar: scripts may only propose plain messages, and the visitor confirms each one (seeing the text).
  if (data.state_key !== null && data.state_key !== undefined) {
    return refuse("World scripts can't change room state");
  }
  if (data.type !== "m.room.message") return refuse(`World scripts can't send ${data.type} events`);

  const content = (data.content ?? {}) as { msgtype?: unknown; body?: unknown };
  if (typeof content.msgtype !== "string" || !SCRIPT_SENDABLE_MSGTYPES.has(content.msgtype)) {
    return refuse("World scripts can only send text, emote or notice messages");
  }
  if (typeof content.body !== "string" || content.body.length === 0) return refuse("Invalid request - missing body");
  if (content.body.length > SCRIPT_MESSAGE_MAX_LENGTH) return refuse("Message too long");
  if (matrixModule.sendDeclines >= SCRIPT_SEND_DECLINE_LIMIT) {
    return refuse("The visitor has declined this world's messages");
  }
  if (matrixModule.sendPending) return refuse("Another message is waiting for the visitor's answer");

  const scriptUrl = matrixModule.activeScriptUrl ?? "";
  const msgtype = content.msgtype;
  const body = content.body;
  matrixModule.sendPending = true;
  const sendEventPromise: Promise<unknown> = requestScriptConsent({
    kind: "send",
    roomId: room.id,
    scriptUrl,
    msgtype,
    body,
  })
    .finally(() => {
      matrixModule.sendPending = false;
    })
    .then((granted) => {
      if (!granted) {
        matrixModule.sendDeclines++;
        throw new Error("declined");
      }
      if (matrixModule.activeRoom !== room) throw new Error("left the world");
      // Only the fields we checked, plus a marker that a script sent it.
      return room.sendEvent("m.room.message", {
        msgtype,
        body,
        [VIA_SCRIPT_KEY]: { world: room.id, script: scriptUrl },
      });
    });

  sendEventPromise
    .then((event: any) => {
      // TODO: the send call above could return it to get the event id...
      reply(ctx, request, {
        room_id: event?.room_id,
        event_id: event?.event_id,
      });
    })
    .catch((error) => {
      if (error?.message !== "declined") console.error("Error sending event: ", error);
      reply(ctx, request, {
        error: {
          message: error?.message === "declined" ? "The visitor declined to send this message" : "Error sending event",
        },
      });
    });
}

function handleReadEventsAction(
  ctx: MainContext,
  matrixModule: MatrixModuleState,
  widget: WidgetContext,
  request: WidgetAPIRequest
) {
  const session = matrixModule.activeSession;

  if (!session) {
    throw new Error("No session set");
  }

  const room = matrixModule.activeRoom;

  if (!room) {
    throw new Error("Room not loaded yet");
  }

  const data = request.data as WidgetReadEventsData;

  if (!data.type) {
    return reply(ctx, request, {
      error: {
        message: "Invalid request - missing event type",
      },
    });
  }

  if (data.limit !== undefined && (!data.limit || data.limit < 0)) {
    return reply(ctx, request, {
      error: {
        message: "Invalid request - limit out of range",
      },
    });
  }

  if (data.room_ids !== undefined) {
    return reply(ctx, request, {
      error: {
        message: "Reading events from multiple rooms is not currently supported.",
      },
    });
  }

  const limit = data.limit || 0;

  let events: Promise<ClientEvent[]> = Promise.resolve([]);

  // Buzzar: scripts may read the world room's state (any member can see it), never its chat history.
  if (data.state_key !== undefined) {
    const stateKey = data.state_key === true ? undefined : data.state_key.toString();

    if (stateKey) {
      events = room.observeStateTypeAndKey(data.type, stateKey).then((value) => {
        const stateEvent = value.get() as ClientEvent | undefined;

        if (stateEvent) {
          return [stateEvent];
        } else {
          return [];
        }
      });
    } else {
      events = room.observeStateType(data.type).then((map) => {
        const items = Array.from(map.values()) as ClientEvent[];

        if (limit) {
          return items.slice(0, limit);
        } else {
          return items;
        }
      });
    }
  } else {
    return reply(ctx, request, { error: { message: "World scripts can't read chat history" } });
  }

  return events.then((evs) => {
    reply(ctx, request, {
      events: evs,
    });
  });
}

export function setActiveMatrixRoom(ctx: MainContext, session: Session, roomId: string, scriptUrl?: string) {
  const matrixModule = getModule(ctx, MatrixModule);

  const room = session.rooms.get(roomId);

  if (!room) {
    throw new Error("Cannot find room");
  }

  matrixModule.activeRoom = room;
  matrixModule.activeSession = session;
  matrixModule.activeScriptUrl = scriptUrl;
  matrixModule.sendDeclines = 0;
}

export function disposeActiveMatrixRoom(ctx: MainContext) {
  const matrixModule = getModule(ctx, MatrixModule);
  matrixModule.activeRoom = undefined;
  matrixModule.activeSession = undefined;
  matrixModule.activeScriptUrl = undefined;

  for (const widget of matrixModule.widgets.values()) {
    for (const request of widget.outboundRequests.values()) {
      request?.reject("Closed Widget");
    }

    if (widget.disposeTimeline) {
      widget.disposeTimeline();
    }
  }

  matrixModule.widgets.clear();
}
