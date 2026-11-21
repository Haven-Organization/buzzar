/**
 * Buzzar's Matrix layer (plan 02): the signed-in session over a matrix-js-sdk client: observable lists of joined
 * rooms and invites, room creation and joining, account data, media URLs and direct homeserver calls.
 */
import {
  ClientEvent,
  MatrixClient,
  MatrixEvent,
  Method,
  Room as SdkRoom,
  RoomEvent,
  RoomMemberEvent,
  RoomStateEvent,
} from "matrix-js-sdk";

import { CallHandler } from "./calls";
import { EventEmitter, ObservableMap, ObservableValue } from "./observable";
import { IBlobHandle, ISessionInfo, Platform } from "./platform";
import { Invite, Room } from "./room";

export enum RoomStatus {
  None = 1 << 0,
  BeingCreated = 1 << 1,
  Invited = 1 << 2,
  Joined = 1 << 3,
  Replaced = 1 << 4,
  Archived = 1 << 5,
}

export enum RoomType {
  World,
  Profile,
}

export enum RoomVisibility {
  DirectMessage,
  Private,
  Public,
}

export interface ICreateRoom {
  type?: RoomType;
  visibility: RoomVisibility;
  name?: string;
  topic?: string;
  isEncrypted?: boolean;
  isFederationDisabled?: boolean;
  alias?: string;
  avatar?:
    | { name: string; blob: IBlobHandle; info: Record<string, unknown> }
    | { url: string; info: Record<string, unknown> };
  powerLevelContentOverride?: Record<string, unknown>;
  invites?: string[];
  initialState?: { type: string; state_key?: string; content: Record<string, unknown> }[];
}

/**
 * Media URLs in the legacy `/_matrix/media/r0/…` form: the service worker (sw.ts) turns them into authenticated
 * requests, so pictures and files load with the session's token without it ever being in a URL.
 */
export class MediaRepository {
  constructor(private homeserver: string) {}

  private parse(mxc: string) {
    const match = /^mxc:\/\/([^/]+)\/([^/?#]+)/.exec(mxc ?? "");
    return match ? `${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}` : undefined;
  }

  mxcUrl(mxc: string): string | undefined {
    const path = this.parse(mxc);
    return path ? `${this.homeserver}/_matrix/media/r0/download/${path}` : undefined;
  }

  mxcUrlThumbnail(mxc: string, width: number, height: number, method: "crop" | "scale"): string | null {
    const path = this.parse(mxc);
    if (!path) return null;
    const w = Math.round(width);
    const h = Math.round(height);
    return `${this.homeserver}/_matrix/media/r0/thumbnail/${path}?width=${w}&height=${h}&method=${method}`;
  }
}

/** A request in flight: `response()` resolves with the parsed body. */
export interface IHomeServerRequest<T = any> {
  response(): Promise<T>;
  abort(): void;
}

function request<T>(promise: Promise<T>, abort: () => void = () => undefined): IHomeServerRequest<T> {
  // Callers that never read the response still shouldn't raise unhandled rejections.
  promise.catch(() => undefined);
  return { response: () => promise, abort };
}

/** Direct homeserver calls the UI makes (each returns a request with `response()`). */
export class HomeServerApi {
  constructor(private client: MatrixClient) {}

  private call<T = any>(method: Method, path: string, body?: unknown, query?: Record<string, string | number>) {
    return request<T>(this.client.http.authedRequest<T>(method, path, query, body as never));
  }

  private room(roomId: string) {
    return `/rooms/${encodeURIComponent(roomId)}`;
  }

  sendState(roomId: string, type: string, stateKey: string, content: unknown) {
    const path = `${this.room(roomId)}/state/${encodeURIComponent(type)}/${encodeURIComponent(stateKey)}`;
    return this.call<{ event_id: string }>(Method.Put, path, content);
  }

  state(roomId: string, type: string, stateKey: string) {
    const path = `${this.room(roomId)}/state/${encodeURIComponent(type)}/${encodeURIComponent(stateKey)}`;
    return this.call<Record<string, any>>(Method.Get, path);
  }

  send(roomId: string, type: string, txnId: string, content: unknown) {
    const path = `${this.room(roomId)}/send/${encodeURIComponent(type)}/${encodeURIComponent(txnId)}`;
    return this.call<{ event_id: string }>(Method.Put, path, content);
  }

  redact(roomId: string, eventId: string, txnId: string, content: unknown) {
    const path = `${this.room(roomId)}/redact/${encodeURIComponent(eventId)}/${encodeURIComponent(txnId)}`;
    return this.call<{ event_id: string }>(Method.Put, path, content);
  }

  event(roomId: string, eventId: string) {
    return this.call<any>(Method.Get, `${this.room(roomId)}/event/${encodeURIComponent(eventId)}`);
  }

  messages(
    roomId: string,
    options: { dir?: "b" | "f"; from?: string; limit?: number; filter?: Record<string, unknown> } = {}
  ) {
    const query: Record<string, string | number> = { dir: options.dir ?? "b" };
    if (options.from) query.from = options.from;
    if (options.limit) query.limit = options.limit;
    if (options.filter) query.filter = JSON.stringify(options.filter);
    return this.call<{ chunk: any[]; start?: string; end?: string }>(
      Method.Get,
      `${this.room(roomId)}/messages`,
      undefined,
      query
    );
  }

  invite(roomId: string, userId: string) {
    return this.call(Method.Post, `${this.room(roomId)}/invite`, { user_id: userId });
  }

  kick(roomId: string, userId: string, reason?: string) {
    return this.call(Method.Post, `${this.room(roomId)}/kick`, { user_id: userId, reason });
  }

  ban(roomId: string, userId: string, reason?: string) {
    return this.call(Method.Post, `${this.room(roomId)}/ban`, { user_id: userId, reason });
  }

  unban(roomId: string, userId: string) {
    return this.call(Method.Post, `${this.room(roomId)}/unban`, { user_id: userId });
  }

  joinIdOrAlias(roomIdOrAlias: string) {
    return this.call<{ room_id: string }>(Method.Post, `/join/${encodeURIComponent(roomIdOrAlias)}`, {});
  }

  profile(userId: string) {
    return this.call<{ displayname?: string; avatar_url?: string }>(
      Method.Get,
      `/profile/${encodeURIComponent(userId)}`
    );
  }

  setProfileDisplayName(userId: string, displayname: string) {
    return this.call(Method.Put, `/profile/${encodeURIComponent(userId)}/displayname`, { displayname });
  }

  setProfileAvatarUrl(userId: string, avatarUrl: string) {
    return this.call(Method.Put, `/profile/${encodeURIComponent(userId)}/avatar_url`, { avatar_url: avatarUrl });
  }

  searchProfile(searchTerm: string, limit?: number) {
    return this.call<{ limited?: boolean; results: any[] }>(Method.Post, "/user_directory/search", {
      search_term: searchTerm,
      limit,
    });
  }

  roomAccountData(userId: string, roomId: string, type: string) {
    const path = `/user/${encodeURIComponent(userId)}${this.room(roomId)}/account_data/${encodeURIComponent(type)}`;
    return this.call<Record<string, any>>(Method.Get, path);
  }

  /** Uploads a file; `response()` resolves `{ content_uri }`. */
  uploadAttachment(
    blob: IBlobHandle | Blob,
    filename?: string,
    options?: { uploadProgress?: (sentBytes: number) => void }
  ): IHomeServerRequest<{ content_uri: string; errcode?: string; error?: string }> {
    const file = blob instanceof Blob ? blob : blob.nativeBlob;
    const controller = new AbortController();
    const promise = this.client.uploadContent(file, {
      name: filename,
      type: file.type || "application/octet-stream",
      progressHandler: (progress) => options?.uploadProgress?.(progress.loaded),
      abortController: controller,
    });
    return request(promise as Promise<{ content_uri: string }>, () => controller.abort());
  }
}

let nextLocalId = 0;

/** A room that's still being created on the server. Emits "change" when it's ready or failed. */
export class RoomBeingCreated extends EventEmitter<{ change: undefined }> {
  readonly id = `local-${++nextLocalId}-${Date.now()}`;
  roomId?: string;
  error?: Error;
  isBeingCreated = true;

  constructor(readonly options: ICreateRoom, readonly mediaRepository: MediaRepository) {
    super();
  }

  get name(): string {
    return this.options.name ?? "New room";
  }

  get avatarColorId(): string {
    return this.roomId ?? this.id;
  }

  get avatarUrl(): string | undefined {
    const avatar = this.options.avatar;
    return avatar && "url" in avatar ? avatar.url : undefined;
  }

  cancel() {
    this.isBeingCreated = false;
    this.emit("change");
  }
}

function presetFor(visibility: RoomVisibility) {
  if (visibility === RoomVisibility.DirectMessage) return "trusted_private_chat";
  return visibility === RoomVisibility.Public ? "public_chat" : "private_chat";
}

export class Session {
  readonly rooms = new ObservableMap<string, Room>();
  readonly invites = new ObservableMap<string, Invite>();
  readonly roomsBeingCreated = new ObservableMap<string, RoomBeingCreated>();
  readonly hsApi: HomeServerApi;
  readonly mediaRepository: MediaRepository;
  readonly callHandler: CallHandler;
  private statusObservers = new Map<string, ObservableValue<RoomStatus>>();
  private disposers: (() => void)[] = [];

  constructor(readonly client: MatrixClient, readonly platform: Platform, private info: ISessionInfo) {
    this.hsApi = new HomeServerApi(client);
    this.mediaRepository = new MediaRepository(info.homeserver.replace(/\/+$/, ""));
    this.callHandler = new CallHandler(this, client);
  }

  get userId(): string {
    return this.info.userId;
  }

  get deviceId(): string {
    return this.info.deviceId;
  }

  get sessionInfo() {
    const { id, deviceId, userId, homeserver, accountManagementUrl } = this.info;
    return { id, deviceId, userId, homeserver, accountManagementUrl };
  }

  /** Whether end-to-end encryption is set up for this device. */
  get hasIdentity(): boolean {
    return !!this.client.getCrypto();
  }

  /** @internal Called once the client has rooms (after the first sync, or from the local store). */
  start() {
    const client = this.client;
    for (const room of client.getRooms()) this.place(room);

    const onRoom = (room: SdkRoom) => this.place(room);
    const onMembership = (room: SdkRoom) => this.place(room);
    const onDelete = (roomId: string) => this.drop(roomId);
    const touchRoom = (room?: SdkRoom | null) => room && this.touch(room.roomId);
    const onTimeline = (_event: MatrixEvent, room?: SdkRoom) => touchRoom(room);
    const onState = (event: MatrixEvent) => this.touch(event.getRoomId());
    const onName = (room: SdkRoom) => touchRoom(room);
    const onReceipt = (_event: MatrixEvent, room: SdkRoom) => touchRoom(room);
    const onAccountData = (event: MatrixEvent) => {
      if (event.getType() !== "m.direct") return;
      for (const id of this.rooms.keys()) this.touch(id);
    };
    const onMember = (event: MatrixEvent) => this.touch(event.getRoomId());
    // Typing notifications, passed on as a window event (see ui/utils/typing.ts).
    const onTyping = (event: MatrixEvent) => {
      window.dispatchEvent(
        new CustomEvent("buzzar:ephemeral", {
          detail: { roomId: event.getRoomId(), events: [{ type: "m.typing", content: event.getContent() }] },
        })
      );
    };

    client.on(ClientEvent.Room, onRoom);
    client.on(RoomEvent.MyMembership, onMembership);
    client.on(ClientEvent.DeleteRoom, onDelete);
    client.on(RoomEvent.Timeline, onTimeline);
    client.on(RoomStateEvent.Events, onState);
    client.on(RoomEvent.Name, onName);
    client.on(RoomEvent.Receipt, onReceipt);
    client.on(ClientEvent.AccountData, onAccountData);
    client.on(RoomMemberEvent.Membership, onMember);
    client.on(RoomMemberEvent.Typing, onTyping);
    this.disposers.push(() => {
      client.off(ClientEvent.Room, onRoom);
      client.off(RoomEvent.MyMembership, onMembership);
      client.off(ClientEvent.DeleteRoom, onDelete);
      client.off(RoomEvent.Timeline, onTimeline);
      client.off(RoomStateEvent.Events, onState);
      client.off(RoomEvent.Name, onName);
      client.off(RoomEvent.Receipt, onReceipt);
      client.off(ClientEvent.AccountData, onAccountData);
      client.off(RoomMemberEvent.Membership, onMember);
      client.off(RoomMemberEvent.Typing, onTyping);
    });
  }

  /** Files a room under joined rooms, invites or neither, by the user's membership. */
  private place(sdkRoom: SdkRoom) {
    const id = sdkRoom.roomId;
    const membership = sdkRoom.getMyMembership();
    if (membership === "join") {
      if (this.invites.has(id)) this.invites.remove(id);
      if (!this.rooms.has(id)) this.rooms.add(id, new Room(this.client, sdkRoom, this.mediaRepository));
      else this.touch(id);
    } else {
      const room = this.rooms.get(id);
      if (room) {
        this.rooms.remove(id);
        room.dispose();
      }
      if (membership === "invite") {
        if (!this.invites.has(id)) this.invites.add(id, new Invite(this.client, sdkRoom, this.mediaRepository));
      } else if (this.invites.has(id)) {
        this.invites.remove(id);
      }
    }
    this.statusObservers.get(id)?.set(this.statusOf(id));
  }

  private drop(roomId: string) {
    this.rooms.get(roomId)?.dispose();
    this.rooms.remove(roomId);
    this.invites.remove(roomId);
    this.statusObservers.get(roomId)?.set(this.statusOf(roomId));
  }

  private touch(roomId?: string | null) {
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (room) {
      room.notifyChange();
      this.rooms.update(roomId);
    } else if (this.invites.has(roomId)) {
      this.invites.update(roomId);
    }
  }

  private statusOf(roomId: string): RoomStatus {
    if (this.rooms.has(roomId)) return RoomStatus.Joined;
    if (this.invites.has(roomId)) return RoomStatus.Invited;
    for (const [, creating] of this.roomsBeingCreated) {
      if (creating.id === roomId || creating.roomId === roomId) return RoomStatus.BeingCreated;
    }
    const membership = this.client.getRoom(roomId)?.getMyMembership();
    if (membership === "leave" || membership === "ban") return RoomStatus.Archived;
    return RoomStatus.None;
  }

  /** The user's relation to a room, kept up to date. */
  async observeRoomStatus(roomId: string): Promise<ObservableValue<RoomStatus>> {
    let observer = this.statusObservers.get(roomId);
    if (!observer) {
      observer = new ObservableValue(this.statusOf(roomId));
      this.statusObservers.set(roomId, observer);
    } else {
      observer.set(this.statusOf(roomId));
    }
    return observer;
  }

  /** Joins a room by ID or alias; resolves with its room ID once it's in `rooms`. */
  async joinRoom(roomIdOrAlias: string, viaServers?: string[]): Promise<string> {
    const sdkRoom = await this.client.joinRoom(roomIdOrAlias, viaServers?.length ? { viaServers } : undefined);
    await this.waitForRoom(sdkRoom.roomId);
    return sdkRoom.roomId;
  }

  /** Resolves once sync has delivered the joined room (or after a few seconds regardless). */
  private waitForRoom(roomId: string, timeoutMs = 15000): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        const sdkRoom = this.client.getRoom(roomId);
        if (sdkRoom?.getMyMembership() === "join") {
          this.place(sdkRoom);
          return true;
        }
        return false;
      };
      if (check()) return resolve();
      const done = () => {
        clearTimeout(timer);
        this.client.off(ClientEvent.Room, onChange);
        this.client.off(RoomEvent.MyMembership, onChange);
        resolve();
      };
      const onChange = () => {
        if (check()) done();
      };
      const timer = setTimeout(done, timeoutMs);
      this.client.on(ClientEvent.Room, onChange);
      this.client.on(RoomEvent.MyMembership, onChange);
    });
  }

  /** Starts creating a room; the returned object emits "change" when it's done (see `roomId`/`error`). */
  createRoom(options: ICreateRoom): RoomBeingCreated {
    const creating = new RoomBeingCreated(options, this.mediaRepository);
    this.roomsBeingCreated.add(creating.id, creating);
    this.create(creating)
      .catch((error) => {
        creating.error = error instanceof Error ? error : new Error(String(error));
        console.error("Couldn't create the room", error);
      })
      .finally(() => {
        creating.isBeingCreated = false;
        this.roomsBeingCreated.remove(creating.id);
        creating.emit("change");
      });
    return creating;
  }

  private async create(creating: RoomBeingCreated) {
    const { options } = creating;
    const initialState: Record<string, unknown>[] = [];
    const encrypted = options.isEncrypted ?? options.visibility !== RoomVisibility.Public;
    if (encrypted) {
      initialState.push({
        type: "m.room.encryption",
        state_key: "",
        content: { algorithm: "m.megolm.v1.aes-sha2" },
      });
    }
    if (options.avatar) {
      const content: Record<string, unknown> = { info: options.avatar.info };
      if ("blob" in options.avatar) {
        const upload = await this.hsApi.uploadAttachment(options.avatar.blob, options.avatar.name).response();
        content.url = upload.content_uri;
      } else {
        content.url = options.avatar.url;
      }
      initialState.push({ type: "m.room.avatar", state_key: "", content });
    }
    for (const state of options.initialState ?? []) initialState.push({ state_key: "", ...state });

    const body: Record<string, unknown> = {
      is_direct: options.visibility === RoomVisibility.DirectMessage,
      preset: presetFor(options.visibility),
      initial_state: initialState,
    };
    if (options.name) body.name = options.name;
    if (options.topic) body.topic = options.topic;
    if (options.invites) body.invite = options.invites;
    if (options.alias) body.room_alias_name = options.alias;
    const creation: Record<string, unknown> = {};
    if (options.type === RoomType.World) creation.type = "org.matrix.msc3815.world";
    if (options.type === RoomType.Profile) creation.type = "org.matrix.msc3815.profile";
    if (options.isFederationDisabled === true) creation["m.federate"] = false;
    if (Object.keys(creation).length) body.creation_content = creation;
    if (options.powerLevelContentOverride) body.power_level_content_override = options.powerLevelContentOverride;

    const { room_id: roomId } = await this.client.createRoom(body as never);
    if (options.visibility === RoomVisibility.DirectMessage && options.invites?.length) {
      await this.markDirect(roomId, options.invites[0]).catch(() => undefined);
    }
    await this.waitForRoom(roomId);
    creating.roomId = roomId;
  }

  private async markDirect(roomId: string, userId: string) {
    const direct = { ...((this.client.getAccountData("m.direct" as never)?.getContent() as object) ?? {}) } as Record<
      string,
      string[]
    >;
    direct[userId] = [...new Set([...(direct[userId] ?? []), roomId])];
    await this.client.setAccountData("m.direct" as never, direct as never);
  }

  /** Account data content from the server, or undefined when there is none. */
  async getAccountData(type: string): Promise<any> {
    const content = await this.client.getAccountDataFromServer(type as never);
    return content ?? undefined;
  }

  async setAccountData(type: string, content: unknown): Promise<void> {
    await this.client.setAccountData(type as never, content as never);
  }

  /** @internal */
  dispose() {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.callHandler.dispose();
    for (const [, room] of this.rooms) room.dispose();
  }
}
