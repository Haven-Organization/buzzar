import {
  CallIntent,
  Client,
  GroupCall,
  LocalMedia,
  Member,
  Platform,
  Room,
  Session,
  SubscriptionHandle,
} from "@thirdroom/hydrogen-view-sdk";

import { exitWorld } from "../../plugins/thirdroom/thirdroom.main";
import { setLocalMediaStream } from "../audio/audio.main";
import { MainContext } from "../MainThread";
import { addPeer, disconnect, removePeer, setHost } from "./network.main";
import { reconcilePeerDevices } from "./peerDevices";
import { getRoomCall } from "../../ui/utils/matrixUtils";
import { startAvatarSync } from "../avatar/avatar.main";
import { microphoneConstraint, registerMicrophoneSwitcher } from "../../ui/utils/microphone";

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

const getWorldGroupCall = (session: Session, world: Room) => getRoomCall(session.callHandler.calls, world.id);

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

  let groupCall = getWorldGroupCall(session, world);

  if (!groupCall) {
    groupCall = await session.callHandler.createCall(world.id, "m.voice", "World Call", CallIntent.Room);
  }

  let stream;
  try {
    // Buzzar: use the microphone chosen in settings.
    stream = await platform.mediaDevices.getMediaTracks(microphoneConstraint() as true | MediaDeviceInfo, false);
  } catch (err) {
    console.error(err);
  }
  const localMedia = stream
    ? new LocalMedia().withUserMedia(stream).withDataChannel({})
    : new LocalMedia().withDataChannel({});

  await groupCall.join(localMedia);

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
    setLocalMediaStream(ctx, call.localMedia?.userMedia);
  });

  // TODO: should peer ids be keyed like the call ids? (userId, deviceId, sessionId)?
  // Or maybe just (userId, deviceId)?
  // engine.setPeerId(client.session.userId);

  let unsubscibeMembersObservable: SubscriptionHandle | undefined;
  /** User ID → the call device backing that user's network peer. */
  const peerDevices = new Map<string, string>();

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
      if (changes.remove.length === 0 && changes.add.length === 0) return;
      updateHost(groupCall, userId);
      for (const peerId of changes.remove) removePeer(ctx, peerId);
      for (const { member } of changes.add) {
        addPeer(ctx, member.userId, member.dataChannel!, member.remoteMedia?.userMedia);
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

  return {
    dispose: () => {
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
