/**
 * Buzzar: world object rules, shared by the main thread (reads the room's rules event) and the game thread
 * (enforces them on what peers send).
 */

/** State event (state_key "") holding a world's rules. */
export const WORLD_RULES_EVENT = "software.haven.world.rules";

/** The stock objects anyone can spawn from the action bar (prefab names). */
export const STOCK_SPAWNABLES = [
  "small-crate",
  "medium-crate",
  "large-crate",
  "small-ball",
  "mirror-ball",
  "black-mirror-ball",
  "emissive-ball",
  "trampoline",
] as const;

/**
 * Behaviours a world can turn off for spawned Things, whatever its list says: a Thing whose file has any of these
 * glTF extensions isn't allowed. Keyed by extension name, so new behaviours (HAVEN_seat, HAVEN_mirror…) slot in.
 */
export const THING_BEHAVIOURS = ["HAVEN_trampoline"] as const;

/** The behaviours each stock Thing has (from its file; listed here so peers can check before the file loads). */
const STOCK_BEHAVIOURS: Record<string, readonly string[]> = { trampoline: ["HAVEN_trampoline"] };

const MXC_THING = /^mxc:\/\/[A-Za-z0-9.\-:[\]]+\/[A-Za-z0-9_-]+$/;
/** Most Things a world's list can hold. */
export const MAX_LISTED_THINGS = 500;

/**
 * Whether `id` names a spawnable Thing (which world rules govern): a stock Thing's prefab name, or a custom Thing's
 * file (its exact mxc:// URI, so a world can allow one particular file and nothing else). Anything else (avatar
 * parts, copies of a world's own grabbable objects) isn't the world rules' business.
 */
export function isThingId(id: string) {
  return (STOCK_SPAWNABLES as readonly string[]).includes(id) || MXC_THING.test(id);
}

/** The behaviours a Thing is known to have. Custom Things: read from their file once those can be spawned. */
export function thingBehaviours(id: string): readonly string[] {
  return STOCK_BEHAVIOURS[id] ?? [];
}

/** One Thing on a world's list. `name` and `preview_url` are only for showing it in World Settings. */
export interface ListedThing {
  id: string;
  allow: boolean;
  name?: string;
  preview_url?: string;
}

export interface SpawnRules {
  /** Things that aren't on the list: "allow" (a block list) or "block" (an allow list). */
  default: "allow" | "block";
  /** Thing id → allowed or not. */
  things: Record<string, boolean>;
  /** Behaviours (glTF extension names) no spawned Thing may have. */
  blockedBehaviours: string[];
  /** Objects one person may have out at once; undefined = no limit beyond the world's max_member_object_cap. */
  maxPerUser?: number;
}

export const DEFAULT_SPAWN_RULES: SpawnRules = { default: "allow", things: {}, blockedBehaviours: [] };

/** The rules event's `objects` list, validated (untrusted), in order. Old events' `allowed` become blocked stock. */
export function parseListedThings(objects: unknown): ListedThing[] {
  const o = (typeof objects === "object" && objects !== null ? objects : {}) as Record<string, unknown>;
  const list: ListedThing[] = [];
  const seen = new Set<string>();
  if (Array.isArray(o.things)) {
    for (const entry of o.things) {
      if (list.length >= MAX_LISTED_THINGS) break;
      if (typeof entry !== "object" || entry === null) continue;
      const r = entry as Record<string, unknown>;
      if (typeof r.id !== "string" || !isThingId(r.id) || seen.has(r.id) || typeof r.allow !== "boolean") continue;
      seen.add(r.id);
      const thing: ListedThing = { id: r.id, allow: r.allow };
      if (typeof r.name === "string" && r.name.trim()) thing.name = r.name.trim().slice(0, 200);
      if (typeof r.preview_url === "string" && MXC_THING.test(r.preview_url)) thing.preview_url = r.preview_url;
      list.push(thing);
    }
  } else if (o.default === undefined && Array.isArray(o.allowed)) {
    // Before lists (2026-11-16 to 11-20): `allowed` named the stock Things allowed; everything else was allowed.
    for (const id of STOCK_SPAWNABLES) if (!o.allowed.includes(id)) list.push({ id, allow: false });
  }
  return list;
}

/** Parses the rules event's content (untrusted). */
export function parseSpawnRules(content: unknown, legacyCap?: unknown): SpawnRules {
  const objects = (content as { objects?: unknown } | undefined)?.objects as Record<string, unknown> | undefined;
  const rules: SpawnRules = {
    default: objects?.default === "block" ? "block" : "allow",
    things: {},
    blockedBehaviours: [],
  };
  for (const thing of parseListedThings(objects)) rules.things[thing.id] = thing.allow;
  if (Array.isArray(objects?.blocked_behaviours)) {
    rules.blockedBehaviours = objects!.blocked_behaviours.filter(
      (b): b is string => typeof b === "string" && b.length <= 100
    );
  }
  const max = objects?.max_per_user ?? legacyCap;
  if (typeof max === "number" && Number.isFinite(max) && max >= 0) rules.maxPerUser = Math.floor(max);
  return rules;
}

/** Whether the world's rules let people spawn Thing `id` (anything that isn't a Thing is always allowed). */
export function isSpawnAllowed(rules: SpawnRules, id: string) {
  if (!isThingId(id)) return true;
  if (thingBehaviours(id).some((b) => rules.blockedBehaviours.includes(b))) return false;
  return rules.things[id] ?? rules.default !== "block";
}

/**
 * The rules event's `objects` for these settings. Also writes the old `allowed` (the stock Things allowed), so
 * clients from before lists still enforce the stock part.
 */
export function serializeObjectRules(
  previous: unknown,
  rules: { default: "allow" | "block"; things: ListedThing[]; blockedBehaviours: string[] }
): Record<string, unknown> {
  const parsed: SpawnRules = {
    default: rules.default,
    things: Object.fromEntries(rules.things.map((t) => [t.id, t.allow])),
    blockedBehaviours: rules.blockedBehaviours,
  };
  return {
    ...(typeof previous === "object" && previous !== null ? previous : {}),
    default: rules.default,
    things: rules.things.slice(0, MAX_LISTED_THINGS),
    blocked_behaviours: rules.blockedBehaviours,
    allowed: STOCK_SPAWNABLES.filter((id) => isSpawnAllowed(parsed, id)),
  };
}

export enum SpawnRulesMessageType {
  SetSpawnRules = "set-spawn-rules",
  SpawnRuleViolation = "spawn-rule-violation",
}

export interface SetSpawnRulesMessage {
  type: SpawnRulesMessageType.SetSpawnRules;
  rules: SpawnRules;
}

export interface SpawnRuleViolationMessage {
  type: SpawnRulesMessageType.SpawnRuleViolation;
  peerId: string;
  reason: string;
}
