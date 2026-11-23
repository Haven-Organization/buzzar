import { RoomStateEvent } from "matrix-js-sdk";

import {
  CallIntent,
  CallMethod,
  callMethodOverride,
  Client,
  decideCallMethod,
  getCallMethodChooser,
  LiveKitCall,
  GroupCall,
  LocalMedia,
  Member,
  Platform,
  Room,
  Session,
  SubscriptionHandle,
} from "../../matrix";
import { exitWorld } from "../../plugins/thirdroom/thirdroom.main";
import { AudioModule, setLocalMediaStream, setPeerMediaStream } from "../audio/audio.main";
import { MainContext } from "../MainThread";
import { getModule, registerMessageHandler } from "../module/module.common";
import { VoiceAudibilityMessage, VoiceAudibilityMessageType } from "../audio/voice.common";
import { ScreenShare, setScreenShare } from "../screenshare/screenShare.main";
import { parseScreenShareRule } from "../screenshare/screenShare.common";
import { WORLD_RULES_EVENT } from "./spawnRules.common";
import { addPeer, disconnect, removePeer, setHost } from "./network.main";
import { reconcilePeerDevices } from "./peerDevices";
import { startAvatarSync } from "../avatar/avatar.main";
import { microphoneConstraint, registerMicrophoneSwitcher } from "../../ui/utils/microphone";
import { liveKitMembershipKey } from "../../ui/utils/callCleanup";
import { confirmDialog } from "../../ui/views/components/confirm-dialog/ConfirmDialog";

export interface MatrixNetworkInterface {
  dispose: () => void;
}

function memberComparator(a: Member, b: Member): number {
  if (a.eventTimestamp === b.eventTimestamp) {
    return a.deviceIndex - b.deviceIndex;
  }

  return a.eventTimestamp - b.eventTimestamp;
}

function isOlderThanLocalHost(groupCall: GroupCall, member: Member): boolean {
  if (groupCall.eventTimestamp === member.eventTimestamp) {
    return groupCall.deviceIndex! <= member.deviceIndex;
  }

  return groupCall.eventTimestamp! < member.eventTimestamp;
}

function getReliableHost(groupCall: GroupCall): Member | undefined {
  const sortedMembers = Array.from(new Map(groupCall.members).values())
    .sort(memberComparator)
    .filter((member) => member.isConnected && member.dataChannel);

  if (sortedMembers.length === 0) return undefined;
  if (isOlderThanLocalHost(groupCall, sortedMembers[0])) return undefined;

  return sortedMembers[0];
}

/**
 * Removes this device's membership of one kind of world call, if the room state still lists it. `keepalive` lets the
 * request outlive the page (see leaveOnPageHide).
 */
function removeOwnMembership(session: Session, world: Room, method: CallMethod, keepalive = false) {
  const client = session.client;
  const token = client.getAccessToken();
  if (!token) return;
  const memberEvent = "org.matrix.msc3401.call.member";
  const base = `${client.baseUrl.replace(/\/+$/, "")}/_matrix/client/v3/rooms/${encodeURIComponent(world.id)}/state/`;
  const put = (stateKey: string, body: unknown) =>
    fetch(`${base}${memberEvent}/${encodeURIComponent(stateKey)}`, {
      method: "PUT",
      keepalive,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => undefined);

  if (method === "livekit") {
    const key = liveKitMembershipKey(session.userId, session.deviceId);
    const content = world.sdk.currentState.getStateEvents(memberEvent, key)?.getContent();
    if (content && Object.keys(content).length > 0) put(key, {});
    return;
  }
  const content = world.sdk.currentState.getStateEvents(memberEvent, session.userId)?.getContent() as
    | { "m.calls"?: { "m.devices"?: { device_id?: string }[] }[] }
    | undefined;
  const calls = content?.["m.calls"];
  if (!calls?.some((c) => c["m.devices"]?.some((d) => d.device_id === session.deviceId))) return;
  const remaining = calls
    .map((c) => ({ ...c, "m.devices": (c["m.devices"] ?? []).filter((d) => d.device_id !== session.deviceId) }))
    .filter((c) => c["m.devices"].length > 0);
  put(session.userId, { ...content, "m.calls": remaining });
}

/** Thrown when the player cancels the "which call?" question: the world isn't entered. */
export class CallChoiceCancelled extends Error {
  constructor() {
    super("Entering the world was cancelled.");
  }
}

/**
 * Buzzar: the world call to join. New calls use the world's recommended method (or the developer override); if a call
 * of another method is already open, the player is asked which one to join (callMethod.ts).
 */
async function chooseWorldCall(session: Session, world: Room): Promise<GroupCall> {
  const override = callMethodOverride();
  const preferred = override ?? (await session.callHandler.recommendedMethod(world.id));
  const open = await session.callHandler.openWorldCalls(world.id);
  const decision = decideCallMethod(preferred, open);
  let method: CallMethod | undefined;
  if (decision.kind === "join") {
    method = decision.method;
  } else {
    const chooser = getCallMethodChooser();
    method = chooser
      ? await chooser(
          { id: world.id, name: world.name ?? "this world", preferredFrom: override ? "setting" : "world" },
          decision
        )
      : decision.options[0].method;
    if (!method) throw new CallChoiceCancelled();
  }
  if (method === "livekit") return session.callHandler.liveKitCall(world.id);
  return (
    (await session.callHandler.getCallForRoom(world.id)) ??
    (await session.callHandler.createCall(world.id, "m.voice", "World Call", CallIntent.Room))
  );
}

export async function createMatrixNetworkInterface(
  ctx: MainContext,
  client: Client,
  platform: Platform,
  world: Room
): Promise<MatrixNetworkInterface> {
  const session = client.session;

  if (!session) {
    throw new Error("You must initialize the client session before creating the network interface");
  }

  let groupCall = await chooseWorldCall(session, world);

  let stream;
  try {
    // Buzzar: use the microphone chosen in settings.
    stream = await platform.mediaDevices.getMediaTracks(microphoneConstraint() as true | MediaDeviceInfo, false);
  } catch (err) {
    // Buzzar: the chosen mic may be unplugged or have a new ID (e.g. after a reboot): try the default one.
    console.warn("Couldn't open the chosen microphone; trying the default one.", err);
    try {
      stream = await platform.mediaDevices.getMediaTracks(true, false);
    } catch (fallbackErr) {
      // No microphone at all: join with the data channel only (others still see and hear the world, not you).
      console.warn("No microphone available; joining without one.", fallbackErr);
    }
  }
  const localMedia = stream
    ? new LocalMedia().withUserMedia(stream).withDataChannel({})
    : new LocalMedia().withDataChannel({});

  try {
    await groupCall.join(localMedia);
  } catch (error) {
    if (groupCall.method !== "livekit") throw error;
    // Buzzar: LiveKit couldn't connect (no LiveKit service, refused, unreachable). Say why, and offer a peer-to-peer
    // call instead, which the LiveKit call's players can't see or hear.
    console.error("Couldn't join the LiveKit call", error);
    await groupCall.leave().catch(() => undefined);
    const reason = error instanceof Error ? error.message : String(error);
    const fallback = await confirmDialog({
      title: "Couldn't Connect to the LiveKit Call",
      message:
        `${reason}\n\nYou can join a peer-to-peer call instead, but players in the LiveKit call won't see or hear ` +
        "you, and you won't see or hear them.",
      confirmLabel: "Join Peer-to-Peer Instead",
      cancelLabel: "Back to Menu",
    });
    if (!fallback) throw new CallChoiceCancelled();
    groupCall =
      (await session.callHandler.getCallForRoom(world.id)) ??
      (await session.callHandler.createCall(world.id, "m.voice", "World Call", CallIntent.Room));
    await groupCall.join(localMedia);
  }
  // Buzzar: this device may still be listed in the world's call of the other kind (an app closed without leaving,
  // before switching kinds): drop that, or others are offered a call with a ghost of us in it.
  removeOwnMembership(session, world, groupCall.method === "livekit" ? "mesh" : "livekit");

  // Mute after connecting based on user preference
  if (groupCall.muteSettings?.microphone === false && localStorage.getItem("microphone") !== "true") {
    groupCall.setMuted(groupCall.muteSettings.toggleMicrophone());
  }

  setLocalMediaStream(ctx, groupCall.localMedia?.userMedia);

  // Buzzar: switch microphones from settings without leaving the world. Keeps the current mute state.
  const call = groupCall;
  registerMicrophoneSwitcher(async (constraint) => {
    const current = call.localMedia;
    if (!current) return;
    const stream = await platform.mediaDevices.getMediaTracks(constraint as true | MediaDeviceInfo, false);
    // setMedia stops the old microphone's tracks; re-applying the mute settings keeps a muted mic muted.
    await call.setMedia(current.withUserMedia(stream));
    if (call.muteSettings) await call.setMuted(call.muteSettings);
    // Detach the old microphone first: setLocalMediaStream throws if a source is still connected.
    setLocalMediaStream(ctx, undefined);
    setLocalMediaStream(ctx, call.localMedia?.userMedia);
  });

  // TODO: should peer ids be keyed like the call ids? (userId, deviceId, sessionId)?
  // Or maybe just (userId, deviceId)?
  // engine.setPeerId(client.session.userId);

  let unsubscibeMembersObservable: SubscriptionHandle | undefined;
  /** User ID → the call device backing that user's network peer. */
  const peerDevices = new Map<string, string>();
  /** The voice stream each connected peer's audio is playing from (undefined: none yet). */
  const peerStreams = new Map<string, MediaStream | undefined>();

  const userId = session.userId;

  const initialHostId = await getInitialHost(groupCall, userId);
  await joinWorld(groupCall, userId, initialHostId === userId);

  // Buzzar: resolve custom avatars for us and every peer in the call.
  const avatarSync = startAvatarSync(ctx, { session, platform, sessionId: client.sessionId, world, groupCall });

  function getInitialHost(groupCall: GroupCall, userId: string): Promise<string> {
    // Of the all group call members find the one whose member event is oldest
    // If the member has multiple devices get the device with the lowest device index
    // Wait for that member to be connected and return their user id
    // If the member hasn't connected in 10 seconds, return the longest connected user id

    return new Promise((resolve) => {
      let timeout: number | undefined = undefined;

      const reliableHost = getReliableHost(groupCall);
      if (reliableHost) {
        resolve(reliableHost.userId);
        return;
      }
      if (groupCall.members.size === 0) {
        resolve(userId);
        return;
      }

      const unsubscribe = groupCall.members.subscribe({
        onAdd() {
          const host = getReliableHost(groupCall);
          if (host) {
            clearTimeout(timeout);
            unsubscribe();
            resolve(host.userId);
          }
        },
        onRemove() {
          const host = getReliableHost(groupCall);
          if (host) {
            clearTimeout(timeout);
            unsubscribe();
            resolve(host.userId);
          }
        },
        onReset() {
          throw new Error("Unexpected reset of groupCall.members");
        },
        onUpdate() {
          const host = getReliableHost(groupCall);
          if (host) {
            clearTimeout(timeout);
            unsubscribe();
            resolve(host.userId);
          }
        },
      });

      // wait if any member to become reliable.
      // resolve otherwise
      timeout = window.setTimeout(() => {
        unsubscribe();
        const host = getReliableHost(groupCall);
        resolve(host?.userId ?? userId);
      }, 10000);
    });
  }

  async function joinWorld(groupCall: GroupCall, userId: string, isHost: boolean) {
    if (isHost) setHost(ctx, userId);

    // Buzzar: one peer per user, backed by one connected device (see peerDevices.ts).
    const syncPeers = () => {
      const changes = reconcilePeerDevices(
        peerDevices,
        Array.from(groupCall.members, ([, member]: [string, Member]) => ({
          member,
          userId: member.userId,
          deviceId: member.deviceId,
          usable: !!(member.isConnected && member.dataChannel),
        })),
        userId
      );
      if (changes.remove.length > 0 || changes.add.length > 0) {
        updateHost(groupCall, userId);
        for (const peerId of changes.remove) {
          removePeer(ctx, peerId);
          peerStreams.delete(peerId);
        }
        for (const { member } of changes.add) {
          const stream = member.remoteMedia?.userMedia;
          addPeer(ctx, member.userId, member.dataChannel!, stream);
          peerStreams.set(member.userId, stream);
        }
      }

      // A peer's voice can arrive after its data channel opened (seen with older builds as the other side): hand
      // the engine the stream when it shows up or changes, or that person is never heard and their mouth never
      // moves.
      for (const [, member] of groupCall.members) {
        if (peerDevices.get(member.userId) !== member.deviceId || !peerStreams.has(member.userId)) continue;
        const stream = member.remoteMedia?.userMedia;
        if (stream && stream !== peerStreams.get(member.userId)) {
          setPeerMediaStream(getModule(ctx, AudioModule), member.userId, stream);
          peerStreams.set(member.userId, stream);
        }
      }
    };

    unsubscibeMembersObservable = groupCall.members.subscribe({
      onAdd: syncPeers,
      onRemove() {
        updateHost(groupCall, userId);
        syncPeers();
      },
      onReset() {
        throw new Error("Unexpected reset of groupCall.members");
      },
      onUpdate: syncPeers,
    });

    syncPeers();
  }

  function updateHost(groupCall: GroupCall, userId: string) {
    // Of the connected members find the one whose member event is oldest
    // If the member has multiple devices get the device with the lowest device index

    const reliableHost = getReliableHost(groupCall);

    if (reliableHost) {
      // TODO: use powerlevels to determine host
      setHost(ctx, reliableHost.userId);
    } else {
      setHost(ctx, userId);
    }
  }

  // Buzzar: only receive the voices you can hear (voice range, stage areas: engine/audio/voice.game.ts).
  const stopVoiceAudibility = registerMessageHandler(
    ctx,
    VoiceAudibilityMessage,
    (_ctx: MainContext, message: VoiceAudibilityMessageType) => {
      if (groupCall instanceof LiveKitCall) groupCall.setAudibleUsers(message.audible);
    }
  );

  // Buzzar (Third Room #398): screen sharing, on LiveKit calls. The world's rules say who may share; each viewer
  // applies them, so a screen from someone who may not share isn't shown.
  let screenShare: ScreenShare | undefined;
  let stopWatchingShareRules: (() => void) | undefined;
  if (groupCall instanceof LiveKitCall && groupCall.liveKitRoom) {
    const state = world.sdk.currentState;
    const mayShare = (sharer: string) => {
      const rule = parseScreenShareRule(state.getStateEvents(WORLD_RULES_EVENT, "")?.getContent());
      if (rule === "everyone") return true;
      if (rule === "nobody") return false;
      return state.hasSufficientPowerLevelFor("kick", world.sdk.getMember(sharer)?.powerLevel ?? 0);
    };
    screenShare = new ScreenShare(ctx, groupCall, { mayShare, ourUserId: userId });
    setScreenShare(screenShare);
    const share = screenShare;
    const onState = (event: { getType(): string }) => {
      const type = event.getType();
      if (type === WORLD_RULES_EVENT || type === "m.room.power_levels") share.rulesChanged();
    };
    state.on(RoomStateEvent.Events, onState);
    stopWatchingShareRules = () => state.off(RoomStateEvent.Events, onState);
  }

  // Buzzar: closing the page or app can't wait for a normal leave, so the membership stayed behind (an hour for mesh
  // calls) and others saw a player who wasn't there. On page hide, send the leave as a keepalive request, which the
  // browser finishes after the page is gone.
  const leaveOnPageHide = (event: PageTransitionEvent) => {
    if (event.persisted) return; // kept in the back/forward cache: the page may come back
    if (call.hasJoined) removeOwnMembership(session, world, call.method, true);
  };
  window.addEventListener("pagehide", leaveOnPageHide);

  return {
    dispose: () => {
      window.removeEventListener("pagehide", leaveOnPageHide);
      stopVoiceAudibility();
      stopWatchingShareRules?.();
      if (screenShare) {
        setScreenShare(undefined);
        screenShare.dispose();
      }
      avatarSync.dispose();
      registerMicrophoneSwitcher(undefined);
      disconnect(ctx);

      exitWorld(ctx);

      setLocalMediaStream(ctx, undefined);

      if (unsubscibeMembersObservable) {
        unsubscibeMembersObservable();
      }

      if (groupCall) {
        groupCall.leave();
      }
    },
  };
}

let baseMxNetworkInterface: MatrixNetworkInterface | undefined;
export const registerMatrixNetworkInterface = (matrixNetworkInterface: MatrixNetworkInterface) => {
  baseMxNetworkInterface = matrixNetworkInterface;
};
export const provideMatrixNetworkInterface = (
  update: (mxNetworkInterface: MatrixNetworkInterface | undefined) => void
) => {
  update(baseMxNetworkInterface);
};
