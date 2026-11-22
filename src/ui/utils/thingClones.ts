/**
 * Buzzar: your cloned Things (Third Room #383): a stock Thing with your own name, size, colour, bounciness, weight
 * or glow ("Smaller Crate"). Kept in account data, software.haven.world.thing_clones, so they follow you between
 * devices; the game gets them in a message (plugins/thirdroom, SetThingClones).
 */
import { MatrixAuth } from "./avatarMatrix";
import { getAccountData } from "./legacyAccountData";
import { isThingCloneId, ThingClone } from "../../plugins/thirdroom/thirdroom.common";
import { sanitizeThingVariables, THING_VARIABLE_DEFAULTS } from "../../plugins/spawnables/thingVariables.common";

export const THING_CLONES_TYPE = "software.haven.world.thing_clones";
const MAX_CLONES = 100;
export const MAX_CLONE_NAME = 60;

/** Validates untrusted account data. */
export function parseThingClones(value: unknown): ThingClone[] {
  const list = (value as { clones?: unknown } | null)?.clones;
  if (!Array.isArray(list)) return [];
  const clones: ThingClone[] = [];
  for (const item of list.slice(0, MAX_CLONES)) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !isThingCloneId(r.id) || clones.some((c) => c.id === r.id)) continue;
    if (typeof r.base !== "string" || !THING_VARIABLE_DEFAULTS[r.base]) continue;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, MAX_CLONE_NAME) : "";
    clones.push({ id: r.id, base: r.base, name: name || "Cloned Thing", variables: sanitizeThingVariables(r.base, r.variables) });
  }
  return clones;
}

export function newCloneId() {
  return `clone:${crypto.randomUUID()}`;
}

export async function fetchThingClones(auth: MatrixAuth, userId: string): Promise<ThingClone[]> {
  const res = await getAccountData(auth, userId, THING_CLONES_TYPE);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Couldn't load your cloned Things: ${res.status}`);
  return parseThingClones(await res.json());
}

export async function saveThingClones(auth: MatrixAuth, userId: string, clones: ThingClone[]) {
  const base = auth.homeserver.replace(/\/+$/, "");
  const res = await fetch(
    `${base}/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${THING_CLONES_TYPE}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ clones }),
    }
  );
  if (!res.ok) throw new Error(`Couldn't save your cloned Things: ${res.status} ${await res.text()}`);
}
