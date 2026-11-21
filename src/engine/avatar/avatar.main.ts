/**
 * Buzzar: main-thread avatar sync for a world.
 *
 * Resolves which avatar each player in the world call wants (see src/ui/utils/avatarMatrix.ts) and tells
 * the game worker. Re-resolves a player when their member event changes, which is how in-world avatar
 * switching propagates to everyone.
 */
import { GroupCall, Platform, Room, Session } from "../../matrix";
import { registerMessageHandler, Thread } from "../module/module.common";
import { MainContext } from "../MainThread";
import {
  AvatarContent,
  fetchAvatarCollection,
  fetchProfileAvatar,
  fetchWorldAvatar,
  getBuiltinAvatarContent,
  getSessionAuth,
  MatrixAuth,
  outdatedBuiltinForUrl,
  setProfileAvatar,
  setWorldAvatar,
} from "../../ui/utils/avatarMatrix";
import {
  AnnounceAvatarChangeMessage,
  AvatarPedestalSelectedMessage,
  AvatarPedestalSelectedMessageType,
  getBuiltinAvatarByUri,
  PeerAvatarChangedMessage,
  PeerAvatarChangedMessageType,
  SetPeerAvatarMessage,
  SetPeerAvatarMessageType,
} from "./avatar.common";

export interface AvatarSync {
  /** Re-resolve one player's avatar now (e.g. right after we changed our own). */
  refresh(userId: string): void;
  dispose(): void;
}

/**
 * Other players' avatar changes are only visible to us through their member events, and the room list doesn't notify
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
      const previous = lastSent.get(userId);
      if (previous === key) return;
      lastSent.set(userId, key);
      // Our own avatar changed: tell everyone in the world now (otherwise they'd see it on their next poll).
      if (userId === session.userId && previous !== undefined) {
        ctx.sendMessage(Thread.Game, { type: AnnounceAvatarChangeMessage });
      }
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

  // A built-in avatar (Devil, Rose) we put on before its model was updated still points at the old upload: switch
  // to the new version, so everyone sees the current model.
  async function upgradeOwnBuiltinAvatar() {
    const auth = await getSessionAuth(platform as any, sessionId);
    if (!auth || disposed) return;
    const collection = await fetchAvatarCollection(auth, session.userId);
    const profile = await fetchProfileAvatar(auth, session.userId);
    const inWorld = await fetchWorldAvatar(auth, world.id, session.userId);
    const profileBuiltin = outdatedBuiltinForUrl(collection, profile?.url);
    const worldBuiltin = outdatedBuiltinForUrl(collection, inWorld?.url);
    if ((!profileBuiltin && !worldBuiltin) || disposed) return;
    if (profileBuiltin) {
      await setProfileAvatar(auth, session.userId, getBuiltinAvatarContent(profileBuiltin));
    }
    if (worldBuiltin) {
      const content = getBuiltinAvatarContent(worldBuiltin);
      await setWorldAvatar(auth, world.id, session.userId, content);
    }
    profileCache.delete(session.userId);
    refresh(session.userId);
  }
  upgradeOwnBuiltinAvatar().catch((error) => console.warn("Couldn't update built-in avatar", error));

  watch(session.userId);
  for (const [, member] of groupCall.members) watch(member.userId);

  // Pressing an avatar pedestal: like VRChat, it becomes your avatar everywhere, so it's saved as your profile
  // (default) avatar. A world-only choice for this world would take precedence over it, so that's cleared.
  // Other worlds pick it up when you next enter them; other players here within the profile-cache window.
  let pedestalRequest = Promise.resolve();
  const unregisterPedestal = registerMessageHandler(
    ctx,
    AvatarPedestalSelectedMessage,
    (ctx: MainContext, message: AvatarPedestalSelectedMessageType) => {
      pedestalRequest = pedestalRequest.then(async () => {
        try {
          const auth = await getSessionAuth(platform as any, sessionId);
          if (!auth || disposed) return;
          const builtin = message.uri ? getBuiltinAvatarByUri(message.uri) : undefined;
          if (message.uri === undefined || message.uri.startsWith("mxc://") || builtin) {
            // Bundled avatars (buzzar-builtin:) are worn as their shared mxc copy, so everyone can load them.
            const content = builtin
              ? getBuiltinAvatarContent(builtin)
              : message.uri
              ? { url: message.uri, name: message.name }
              : undefined;
            await setProfileAvatar(auth, session.userId, content);
            if (await fetchWorldAvatar(auth, world.id, session.userId)) {
              await setWorldAvatar(auth, world.id, session.userId, undefined);
            }
            // Apply it to ourselves right away instead of waiting for the profile cache to expire.
            profileCache.delete(session.userId);
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

  // A peer announced an avatar change: look it up now, past the profile cache, and always tell the game thread
  // (it dropped the old avatar and shows the loading placeholder until it hears back).
  const unregisterPeerChanged = registerMessageHandler(
    ctx,
    PeerAvatarChangedMessage,
    (_ctx: MainContext, message: PeerAvatarChangedMessageType) => {
      profileCache.delete(message.peerId);
      lastSent.delete(message.peerId);
      refresh(message.peerId);
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
    refresh(userId) {
      // Called after the user changed their avatar in the editor: their profile may have changed too.
      profileCache.delete(userId);
      refresh(userId);
    },
    dispose() {
      disposed = true;
      if (activeSync === sync) activeSync = undefined;
      window.clearInterval(pollTimer);
      unregisterPedestal();
      unregisterPeerChanged();
      unsubscribeMembers();
      for (const stop of watched.values()) stop();
      watched.clear();
    },
  };
  activeSync = sync;
  return sync;
}
