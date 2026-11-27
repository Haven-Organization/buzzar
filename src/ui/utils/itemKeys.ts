/**
 * Buzzar: which Item is on each number key (1–9 and 0), chosen on the Items screen. Kept in account data,
 * software.haven.world.item_keys, so your keys follow you between devices; the game reads it from a message
 * (plugins/thirdroom, SetItemKeys).
 */
import { MatrixAuth } from "./avatarMatrix";
import { getAccountData } from "./legacyAccountData";
import {
  DEFAULT_ITEM_KEYS,
  isItemCloneId,
  ITEM_KEY_COUNT,
  ItemKeys,
} from "../../plugins/thirdroom/thirdroom.common";
import { isCustomItemId } from "../../engine/network/spawnRules.common";

export const ITEM_KEYS_TYPE = "software.haven.world.item_keys";

/** Validates untrusted account data: ten slots, each an Item id from `known` or empty, no Item on two keys. */
export function parseItemKeys(value: unknown, known: readonly string[]): ItemKeys {
  const list = (value as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(list)) return [...DEFAULT_ITEM_KEYS];
  const keys: ItemKeys = [];
  for (let i = 0; i < ITEM_KEY_COUNT; i++) {
    const id = list[i];
    // Cloned Items (clone:…) are kept even before your clones have loaded; the game ignores ones it doesn't know.
    // Your own Items (mxc://…) are kept too, even before your collection has loaded.
    const valid = typeof id === "string" && (known.includes(id) || isItemCloneId(id) || isCustomItemId(id));
    keys.push(valid && !keys.includes(id) ? id : null);
  }
  return keys;
}

/** The slot `id` is on, or -1. */
export function slotOf(keys: ItemKeys, id: string) {
  return keys.indexOf(id);
}

/**
 * Puts `id` on `slot`. An Item already there moves to the slot `id` came from (a swap), or off the keys if `id`
 * wasn't on one.
 */
export function mapItem(keys: ItemKeys, id: string, slot: number): ItemKeys {
  const next = [...keys];
  const from = next.indexOf(id);
  const displaced = next[slot];
  next[slot] = id;
  if (from !== -1 && from !== slot) next[from] = displaced ?? null;
  return next;
}

/** The Items on keys, in key order (left to right along the keyboard). */
export function mappedOrder(keys: ItemKeys): string[] {
  return keys.filter((id): id is string => !!id);
}

/**
 * Moves `id` to position `index` among the Items on keys (the shelf's order), putting it on a key if it wasn't on
 * one. The keys in use stay the same (plus the first free key for a newcomer), and the Items take them in their new
 * order. Returns undefined if every key is taken and `id` isn't on one.
 */
export function moveMapped(keys: ItemKeys, id: string, index: number): ItemKeys | undefined {
  const order = mappedOrder(keys);
  const slots = keys.flatMap((k, slot) => (k ? [slot] : []));
  const from = order.indexOf(id);
  if (from === -1) {
    const free = keys.indexOf(null);
    if (free === -1) return undefined;
    slots.push(free);
    slots.sort((a, b) => a - b);
  } else {
    order.splice(from, 1);
  }
  order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
  const next: ItemKeys = Array(keys.length).fill(null);
  order.forEach((item, i) => (next[slots[i]] = item));
  return next;
}

/** Takes `id` off its key. */
export function unmapItem(keys: ItemKeys, id: string): ItemKeys {
  return keys.map((k) => (k === id ? null : k));
}

export async function fetchItemKeys(auth: MatrixAuth, userId: string, known: readonly string[]): Promise<ItemKeys> {
  const res = await getAccountData(auth, userId, ITEM_KEYS_TYPE);
  if (res.status === 404) return [...DEFAULT_ITEM_KEYS];
  if (!res.ok) throw new Error(`Couldn't load your Item keys: ${res.status}`);
  return parseItemKeys(await res.json(), known);
}

export async function saveItemKeys(auth: MatrixAuth, userId: string, keys: ItemKeys) {
  const base = auth.homeserver.replace(/\/+$/, "");
  const res = await fetch(
    `${base}/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${ITEM_KEYS_TYPE}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    }
  );
  if (!res.ok) throw new Error(`Couldn't save your Item keys: ${res.status} ${await res.text()}`);
}
