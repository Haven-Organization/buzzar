/**
 * Buzzar: which Thing is on each number key (1–9 and 0), chosen on the Things screen. Kept in account data,
 * software.haven.world.thing_keys, so your keys follow you between devices; the game reads it from a message
 * (plugins/thirdroom, SetThingKeys).
 */
import { MatrixAuth } from "./avatarMatrix";
import { getAccountData } from "./legacyAccountData";
import { DEFAULT_THING_KEYS, THING_KEY_COUNT, ThingKeys } from "../../plugins/thirdroom/thirdroom.common";

export const THING_KEYS_TYPE = "software.haven.world.thing_keys";

/** Validates untrusted account data: ten slots, each a Thing id from `known` or empty, no Thing on two keys. */
export function parseThingKeys(value: unknown, known: readonly string[]): ThingKeys {
  const list = (value as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(list)) return [...DEFAULT_THING_KEYS];
  const keys: ThingKeys = [];
  for (let i = 0; i < THING_KEY_COUNT; i++) {
    const id = list[i];
    keys.push(typeof id === "string" && known.includes(id) && !keys.includes(id) ? id : null);
  }
  return keys;
}

/** The slot `id` is on, or -1. */
export function slotOf(keys: ThingKeys, id: string) {
  return keys.indexOf(id);
}

/**
 * Puts `id` on `slot`. A Thing already there moves to the slot `id` came from (a swap), or off the keys if `id`
 * wasn't on one.
 */
export function mapThing(keys: ThingKeys, id: string, slot: number): ThingKeys {
  const next = [...keys];
  const from = next.indexOf(id);
  const displaced = next[slot];
  next[slot] = id;
  if (from !== -1 && from !== slot) next[from] = displaced ?? null;
  return next;
}

/** Takes `id` off its key. */
export function unmapThing(keys: ThingKeys, id: string): ThingKeys {
  return keys.map((k) => (k === id ? null : k));
}

export async function fetchThingKeys(auth: MatrixAuth, userId: string, known: readonly string[]): Promise<ThingKeys> {
  const res = await getAccountData(auth, userId, THING_KEYS_TYPE);
  if (res.status === 404) return [...DEFAULT_THING_KEYS];
  if (!res.ok) throw new Error(`Couldn't load your Thing keys: ${res.status}`);
  return parseThingKeys(await res.json(), known);
}

export async function saveThingKeys(auth: MatrixAuth, userId: string, keys: ThingKeys) {
  const base = auth.homeserver.replace(/\/+$/, "");
  const res = await fetch(
    `${base}/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${THING_KEYS_TYPE}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    }
  );
  if (!res.ok) throw new Error(`Couldn't save your Thing keys: ${res.status} ${await res.text()}`);
}
