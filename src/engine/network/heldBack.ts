/**
 * Buzzar: the players this client holds back in the world you're in: the people you blocked (Matrix's
 * `m.ignored_user_list`, so it follows your account to every app and device) and the people the world's ban lists
 * ban (src/matrix/policyLists.ts). Held-back players get no network peer (createMatrixNetworkInterface.ts): you don't
 * see their avatar or Things or hear them, and nothing of yours is sent to them; on LiveKit calls the server is told
 * not to send them your voice.
 *
 * World bans can be waived on your own screen (Settings → Safety): friends (people you have direct messages with) are
 * let through by default, people you share another room with only if you choose, and with Developer Mode on you can
 * ignore world ban lists altogether. Your own blocks always apply.
 *
 * Kept here for the interface too (the People list, World Settings).
 */
import { ClientEvent, MatrixClient, MatrixEvent } from "matrix-js-sdk";

import { PolicyRoomStatus, PolicyRule, WorldBanList } from "../../matrix/policyLists";

/** Why a world ban doesn't hold someone back for you. */
export type LetThrough = "friend" | "mutual" | "developer";

export type HeldBackReason = { blocked: true } | { banned: PolicyRule; letThrough?: LetThrough };

export interface HeldBack {
  /** Why this user is or would be held back: you blocked them, or the world's ban list (which rule, and whether
   * your settings let them through anyway). */
  reasonOf(userId: string): HeldBackReason | undefined;
  /** Whether this user is held back for you. */
  isHeldBack(userId: string): boolean;
  /** The followed ban lists, and whether each could be read. */
  listStatus: PolicyRoomStatus[];
  /** The rule banning you, if the world's ban lists ban you (everyone else's Buzzar holds you back). */
  ownBan(): PolicyRule | undefined;
}

let current: (HeldBack & { roomId: string }) | undefined;
const listeners = new Set<() => void>();

export function getHeldBack(roomId: string): HeldBack | undefined {
  return current?.roomId === roomId ? current : undefined;
}

export function onHeldBackChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function changed() {
  for (const listener of listeners) listener();
}

/** Settings → Safety: who gets through world bans for you. */
export const BAN_EXEMPTIONS_KEY = "buzzar.banExemptions";
/** Settings → Developer: ignore world ban lists altogether (only with Developer Mode on). */
export const IGNORE_WORLD_BANS_KEY = "buzzar.ignoreWorldBans";

export interface BanExemptions {
  friends: boolean;
  mutuals: boolean;
}

export const DEFAULT_BAN_EXEMPTIONS: BanExemptions = { friends: true, mutuals: false };

function readJson(key: string): unknown {
  try {
    const item = localStorage.getItem(key);
    return item === null ? undefined : JSON.parse(item);
  } catch {
    return undefined;
  }
}

export function parseBanExemptions(value: unknown): BanExemptions {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return { friends: v.friends !== false, mutuals: v.mutuals === true };
}

function readSettings() {
  return {
    exemptions: parseBanExemptions(readJson(BAN_EXEMPTIONS_KEY)),
    ignoreWorldBans: readJson("buzzar.developerMode") === true && readJson(IGNORE_WORLD_BANS_KEY) === true,
  };
}

/** People you have direct messages with (your account's `m.direct`). */
function friendsOf(client: MatrixClient): Set<string> {
  return new Set(Object.keys(client.getAccountData("m.direct" as never)?.getContent() ?? {}));
}

/** Whether you and this user are both in some room other than this world. */
function sharesARoom(client: MatrixClient, userId: string, exceptRoomId: string): boolean {
  return client
    .getRooms()
    .some(
      (room) =>
        room.roomId !== exceptRoomId &&
        room.getMyMembership() === "join" &&
        room.getMember(userId)?.membership === "join"
    );
}

/** People you blocked (your account's ignore list). */
export function blockedUsers(client: MatrixClient): Set<string> {
  return new Set(client.getIgnoredUsers());
}

/**
 * Starts following who's held back in a world. `onChange` runs whenever that may have changed (a block, an unblock,
 * a ban list update). Returns the check and a dispose function.
 */
export function followHeldBack(client: MatrixClient, worldRoomId: string, ourUserId: string, onChange: () => void) {
  const banList = new WorldBanList(client, worldRoomId);
  let blocked = blockedUsers(client);
  let friends = friendsOf(client);
  let settings = readSettings();
  /** Whether each user shares a room with you, worked out once per change. */
  let mutuals = new Map<string, boolean>();

  const reasonOf = (userId: string): HeldBackReason | undefined => {
    if (userId === ourUserId) return undefined;
    if (blocked.has(userId)) return { blocked: true };
    const rule = banList.banOf(userId);
    if (!rule) return undefined;
    if (settings.ignoreWorldBans) return { banned: rule, letThrough: "developer" };
    if (settings.exemptions.friends && friends.has(userId)) return { banned: rule, letThrough: "friend" };
    if (settings.exemptions.mutuals) {
      let mutual = mutuals.get(userId);
      if (mutual === undefined) {
        mutual = sharesARoom(client, userId, worldRoomId);
        mutuals.set(userId, mutual);
      }
      if (mutual) return { banned: rule, letThrough: "mutual" };
    }
    return { banned: rule };
  };
  const isHeldBack = (userId: string) => {
    const reason = reasonOf(userId);
    return !!reason && !("letThrough" in reason && reason.letThrough);
  };
  const state = {
    roomId: worldRoomId,
    reasonOf,
    isHeldBack,
    get listStatus() {
      return banList.status;
    },
    ownBan: () => banList.banOf(ourUserId),
  };
  current = state;

  const update = () => {
    mutuals = new Map();
    onChange();
    changed();
  };
  const stopBans = banList.subscribe(update);
  const onAccountData = (event: MatrixEvent) => {
    const type = event.getType();
    if (type === "m.ignored_user_list") blocked = blockedUsers(client);
    else if (type === "m.direct") friends = friendsOf(client);
    else return;
    update();
  };
  client.on(ClientEvent.AccountData, onAccountData);
  // The settings change in this tab (useLocalStorage's event) or another one (storage).
  const onSetting = (event: Event) => {
    const key = event instanceof StorageEvent ? event.key : (event as CustomEvent<string>).detail;
    if (key !== BAN_EXEMPTIONS_KEY && key !== IGNORE_WORLD_BANS_KEY && key !== "buzzar.developerMode") return;
    settings = readSettings();
    update();
  };
  window.addEventListener("buzzar-local-storage", onSetting);
  window.addEventListener("storage", onSetting);
  // Shared rooms change as you join and leave rooms, and as members load: work them out again now and then.
  const mutualTimer = window.setInterval(() => {
    if (!settings.exemptions.mutuals || mutuals.size === 0) return;
    mutuals = new Map();
    update();
  }, 60000);
  changed();

  return {
    isHeldBack,
    reasonOf,
    dispose() {
      stopBans();
      window.removeEventListener("buzzar-local-storage", onSetting);
      window.removeEventListener("storage", onSetting);
      window.clearInterval(mutualTimer);
      client.off(ClientEvent.AccountData, onAccountData);
      banList.dispose();
      if (current === state) {
        current = undefined;
        changed();
      }
    },
  };
}
