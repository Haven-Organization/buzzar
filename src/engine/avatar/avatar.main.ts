/**
 * Buzzar: main-thread avatar sync for a world.
 *
 * Resolves which avatar each player in the world call wants (see src/ui/utils/avatarMatrix.ts) and tells
 * the game worker. Re-resolves a player when their member event changes, which is how in-world avatar
 * switching propagates to everyone.
 */
import { GroupCall, Platform, Room, Session } from "@thirdroom/hydrogen-view-sdk";

import { registerMessageHandler, Thread } from "../module/module.common";
import { MainContext } from "../MainThread";
import {
  AvatarContent,
  fetchProfileAvatar,
  fetchWorldAvatar,
  getSessionAuth,
  MatrixAuth,
  setWorldAvatar,
} from "../../ui/utils/avatarMatrix";
import {
  AvatarPedestalSelectedMessage,
  AvatarPedestalSelectedMessageType,
  SetPeerAvatarMessage,
  SetPeerAvatarMessageType,
} from "./avatar.common";

export interface AvatarSync {
  /** Re-resolve one player's avatar now (e.g. right after we changed our own). */
  refresh(userId: string): void;
  dispose(): void;
}

/**
 * Other players' avatar changes are only visible to us through their member events, and Hydrogen doesn't notify
 * on member events whose displayname/avatar/membership didn't change. Until the matrix-js-sdk migration gives
 * us raw member events, re-check everyone in the call on this interval.
 */
const PEER_POLL_INTERVAL_MS = 10_000;
const PROFILE_CACHE_MS = 60_000;

let activeSync: AvatarSync | undefined;

/** Re-resolve a player's avatar in the current world, if we're in one (used after saving in the avatar editor). */
export function refreshWorldAvatar(userId: string) {
  activeSync?.refresh(userId);
}

export function startAvatarSync(
  ctx: MainContext,
  {
    session,
    platform,
    sessionId,
    world,
    groupCall,
  }: {
    session: Session;
    platform: Platform;
    sessionId: string;
    world: Room;
    groupCall: GroupCall;
  }
): AvatarSync {
  let disposed = false;
  const watched = new Map<string, () => void>();
  const generation = new Map<string, number>();
  const lastSent = new Map<string, string>();

  // The default (profile) avatar rarely changes and an unset field is a 404 in the console on every poll, so
  // only re-read it once a minute; the per-world member event is re-read every poll.
  const profileCache = new Map<string, { avatar: AvatarContent | undefined; at: number }>();
  async function resolveAvatarCached(auth: MatrixAuth, userId: string) {
    const fromWorld = await fetchWorldAvatar(auth, world.id, userId);
    if (fromWorld) return fromWorld;
    const cached = profileCache.get(userId);
    if (cached && Date.now() - cached.at < PROFILE_CACHE_MS) return cached.avatar;
    const avatar = await fetchProfileAvatar(auth, userId);
    profileCache.set(userId, { avatar, at: Date.now() });
    return avatar;
  }

  async function refresh(userId: string) {
    const gen = (generation.get(userId) ?? 0) + 1;
    generation.set(userId, gen);

    try {
      const auth = await getSessionAuth(platform as any, sessionId);
      if (!auth) return;
      const avatar = await resolveAvatarCached(auth, userId);
      if (disposed || generation.get(userId) !== gen) return;

      const url = avatar ? session.mediaRepository.mxcUrl(avatar.url) : undefined;
      const key = `${url ?? ""}|${avatar?.name ?? ""}`;
      if (lastSent.get(userId) === key) return;
      lastSent.set(userId, key);
      ctx.sendMessage<SetPeerAvatarMessageType>(Thread.Game, {
        type: SetPeerAvatarMessage,
        peerId: userId,
        url,
        name: avatar?.name,
      });
    } catch (error) {
      console.warn(`Couldn't resolve avatar for ${userId}`, error);
    }
  }

  async function watch(userId: string) {
    if (watched.has(userId) || disposed) return;
    watched.set(userId, () => {});
    refresh(userId);

    // Retained observables free themselves once the last subscriber unsubscribes.
    const observable = await world.observeMember(userId);
    if (!observable || disposed) return;
    const unsubscribe = observable.subscribe(() => refresh(userId));
    watched.set(userId, unsubscribe);
  }

  watch(session.userId);
  for (const [, member] of groupCall.members) watch(member.userId);

  // Pressing an avatar pedestal: wear it in this world by updating our own member event. Everyone (including
  // us) then picks it up through the normal member-event sync above.
  let pedestalRequest = Promise.resolve();
  const unregisterPedestal = registerMessageHandler(
    ctx,
    AvatarPedestalSelectedMessage,
    (ctx: MainContext, message: AvatarPedestalSelectedMessageType) => {
      pedestalRequest = pedestalRequest.then(async () => {
        try {
          const auth = await getSessionAuth(platform as any, sessionId);
          if (!auth || disposed) return;
          if (message.uri === undefined) {
            await setWorldAvatar(auth, world.id, session.userId, undefined);
            refresh(session.userId);
          } else if (message.uri.startsWith("mxc://")) {
            await setWorldAvatar(auth, world.id, session.userId, { url: message.uri, name: message.name });
            // Apply it to ourselves right away instead of waiting for sync.
            refresh(session.userId);
          } else {
            // Not publishable (not on the homeserver): wear it locally only.
            ctx.sendMessage<SetPeerAvatarMessageType>(Thread.Game, {
              type: SetPeerAvatarMessage,
              peerId: session.userId,
              url: message.url,
              name: message.name,
            });
          }
        } catch (error) {
          console.error("Couldn't wear avatar from pedestal", error);
        }
      });
    }
  );

  const unsubscribeMembers = groupCall.members.subscribe({
    onAdd: (_key, member) => watch(member.userId),
    onUpdate: (_key, member) => watch(member.userId),
    onRemove: () => {},
    onReset: () => {},
  });

  const pollTimer = window.setInterval(() => {
    refresh(session.userId);
    for (const [, member] of groupCall.members) refresh(member.userId);
  }, PEER_POLL_INTERVAL_MS);

  const sync: AvatarSync = {
    refresh,
    dispose() {
      disposed = true;
      if (activeSync === sync) activeSync = undefined;
      window.clearInterval(pollTimer);
      unregisterPedestal();
      unsubscribeMembers();
      for (const stop of watched.values()) stop();
      watched.clear();
    },
  };
  activeSync = sync;
  return sync;
}
