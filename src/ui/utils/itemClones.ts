/**
 * Buzzar: your cloned Items (Third Room #383): a stock Item with your own name, size, colour, bounciness, weight
 * or glow ("Smaller Crate"). Kept in account data, software.haven.world.item_clones, so they follow you between
 * devices; the game gets them in a message (plugins/thirdroom, SetItemClones).
 */
import { MatrixAuth } from "./avatarMatrix";
import { getAccountData } from "./legacyAccountData";
import { isItemCloneId, ItemClone } from "../../plugins/thirdroom/thirdroom.common";
import { sanitizeItemVariables, ITEM_VARIABLE_DEFAULTS } from "../../plugins/spawnables/itemVariables.common";

export const ITEM_CLONES_TYPE = "software.haven.world.item_clones";
const MAX_CLONES = 100;
export const MAX_CLONE_NAME = 60;

/** Validates untrusted account data. */
export function parseItemClones(value: unknown): ItemClone[] {
  const list = (value as { clones?: unknown } | null)?.clones;
  if (!Array.isArray(list)) return [];
  const clones: ItemClone[] = [];
  for (const item of list.slice(0, MAX_CLONES)) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !isItemCloneId(r.id) || clones.some((c) => c.id === r.id)) continue;
    if (typeof r.base !== "string" || !ITEM_VARIABLE_DEFAULTS[r.base]) continue;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, MAX_CLONE_NAME) : "";
    clones.push({ id: r.id, base: r.base, name: name || "Cloned Item", variables: sanitizeItemVariables(r.base, r.variables) });
  }
  return clones;
}

export function newCloneId() {
  return `clone:${crypto.randomUUID()}`;
}

export async function fetchItemClones(auth: MatrixAuth, userId: string): Promise<ItemClone[]> {
  const res = await getAccountData(auth, userId, ITEM_CLONES_TYPE);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Couldn't load your cloned Items: ${res.status}`);
  return parseItemClones(await res.json());
}

export async function saveItemClones(auth: MatrixAuth, userId: string, clones: ItemClone[]) {
  const base = auth.homeserver.replace(/\/+$/, "");
  const res = await fetch(
    `${base}/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${ITEM_CLONES_TYPE}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ clones }),
    }
  );
  if (!res.ok) throw new Error(`Couldn't save your cloned Items: ${res.status} ${await res.text()}`);
}
