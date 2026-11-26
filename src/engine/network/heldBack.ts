/**
 * Buzzar: the players this client holds back in the world you're in: the people you blocked (Matrix's
 * `m.ignored_user_list`, so it follows your account to every app and device) and the people the world's ban lists
 * ban (src/matrix/policyLists.ts). Held-back players get no network peer (createMatrixNetworkInterface.ts): you don't
 * see their avatar or Things or hear them, and nothing of yours is sent to them; on LiveKit calls the server is told
 * not to send them your voice.
 *
 * Kept here for the interface too (the People list, World Settings).
 */
import { ClientEvent, MatrixClient, MatrixEvent } from "matrix-js-sdk";

import { PolicyRoomStatus, PolicyRule, WorldBanList } from "../../matrix/policyLists";

export interface HeldBack {
  /** Why this user is held back: you blocked them, or the world's ban list (which rule). */
  reasonOf(userId: string): { blocked: true } | { banned: PolicyRule } | undefined;
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

  const reasonOf = (userId: string) => {
    if (userId === ourUserId) return undefined;
    if (blocked.has(userId)) return { blocked: true as const };
    const rule = banList.banOf(userId);
    return rule ? { banned: rule } : undefined;
  };
  const state = {
    roomId: worldRoomId,
    reasonOf,
    get listStatus() {
      return banList.status;
    },
    ownBan: () => banList.banOf(ourUserId),
  };
  current = state;

  const update = () => {
    onChange();
    changed();
  };
  const stopBans = banList.subscribe(update);
  const onAccountData = (event: MatrixEvent) => {
    if (event.getType() !== "m.ignored_user_list") return;
    blocked = blockedUsers(client);
    update();
  };
  client.on(ClientEvent.AccountData, onAccountData);
  changed();

  return {
    isHeldBack: (userId: string) => !!reasonOf(userId),
    reasonOf,
    dispose() {
      stopBans();
      client.off(ClientEvent.AccountData, onAccountData);
      banList.dispose();
      if (current === state) {
        current = undefined;
        changed();
      }
    },
  };
}
