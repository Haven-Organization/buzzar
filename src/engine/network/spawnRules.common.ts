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
 * Behaviours a world can turn off for spawned Items, whatever its list says: an Item whose file has any of these
 * glTF extensions isn't allowed. Keyed by extension name, so new behaviours (HAVEN_seat, HAVEN_mirror…) slot in.
 */
export const ITEM_BEHAVIOURS = ["HAVEN_trampoline"] as const;

/** The behaviours each stock Item has (from its file; listed here so peers can check before the file loads). */
const STOCK_BEHAVIOURS: Record<string, readonly string[]> = { trampoline: ["HAVEN_trampoline"] };

const MXC_ITEM = /^mxc:\/\/[A-Za-z0-9.\-:[\]]+\/[A-Za-z0-9_-]+$/;
/** Most Items a world's list can hold. */
export const MAX_LISTED_ITEMS = 500;

/**
 * Whether `id` names a spawnable Item (which world rules govern): a stock Item's prefab name, or a custom Item's
 * file (its exact mxc:// URI, so a world can allow one particular file and nothing else). Anything else (avatar
 * parts, copies of a world's own grabbable objects) isn't the world rules' business.
 */
export function isItemId(id: string) {
  return (STOCK_SPAWNABLES as readonly string[]).includes(id) || MXC_ITEM.test(id);
}

/** Whether `id` is a custom Item: a .glb file on Matrix, named by its mxc:// URI. */
export function isCustomItemId(id: string) {
  return MXC_ITEM.test(id);
}

/** Behaviours of custom Item files, learnt as each file loads (until then a custom Item has none we know of). */
const fileBehaviours = new Map<string, readonly string[]>();

/** Records which behaviours (glTF extensions in ITEM_BEHAVIOURS) a custom Item's file uses. */
export function rememberItemBehaviours(id: string, extensionsUsed: unknown) {
  const used = Array.isArray(extensionsUsed) ? extensionsUsed : [];
  fileBehaviours.set(
    id,
    ITEM_BEHAVIOURS.filter((b) => used.includes(b))
  );
}

/**
 * The behaviours an Item is known to have: a stock Item's from this list, a custom Item's once its file has loaded.
 * Every client checks again as a custom file loads (spawnables.game.ts), dropping the object if the world blocks one.
 */
export function itemBehaviours(id: string): readonly string[] {
  return STOCK_BEHAVIOURS[id] ?? fileBehaviours.get(id) ?? [];
}

/** One Item on a world's list. `name` and `preview_url` are only for showing it in World Settings. */
export interface ListedItem {
  id: string;
  allow: boolean;
  name?: string;
  preview_url?: string;
}

export interface SpawnRules {
  /** Items that aren't on the list: "allow" (a block list) or "block" (an allow list). */
  default: "allow" | "block";
  /** Item id → allowed or not. */
  items: Record<string, boolean>;
  /** Behaviours (glTF extension names) no spawned Item may have. */
  blockedBehaviours: string[];
  /** Objects one person may have out at once; undefined = no limit beyond the world's max_member_object_cap. */
  maxPerUser?: number;
}

export const DEFAULT_SPAWN_RULES: SpawnRules = { default: "allow", items: {}, blockedBehaviours: [] };

/** The rules event's `objects` list, validated (untrusted), in order. Old events' `allowed` become blocked stock. */
export function parseListedItems(objects: unknown): ListedItem[] {
  const o = (typeof objects === "object" && objects !== null ? objects : {}) as Record<string, unknown>;
  const list: ListedItem[] = [];
  const seen = new Set<string>();
  // `things`: written before Things became Items (2026-11-27).
  const listed = Array.isArray(o.items) ? o.items : Array.isArray(o.things) ? o.things : undefined;
  if (listed) {
    for (const entry of listed) {
      if (list.length >= MAX_LISTED_ITEMS) break;
      if (typeof entry !== "object" || entry === null) continue;
      const r = entry as Record<string, unknown>;
      if (typeof r.id !== "string" || !isItemId(r.id) || seen.has(r.id) || typeof r.allow !== "boolean") continue;
      seen.add(r.id);
      const item: ListedItem = { id: r.id, allow: r.allow };
      if (typeof r.name === "string" && r.name.trim()) item.name = r.name.trim().slice(0, 200);
      if (typeof r.preview_url === "string" && MXC_ITEM.test(r.preview_url)) item.preview_url = r.preview_url;
      list.push(item);
    }
  } else if (o.default === undefined && Array.isArray(o.allowed)) {
    // Before lists (2026-11-16 to 11-20): `allowed` named the stock Items allowed; everything else was allowed.
    for (const id of STOCK_SPAWNABLES) if (!o.allowed.includes(id)) list.push({ id, allow: false });
  }
  return list;
}

/** Parses the rules event's content (untrusted). */
export function parseSpawnRules(content: unknown, legacyCap?: unknown): SpawnRules {
  const objects = (content as { objects?: unknown } | undefined)?.objects as Record<string, unknown> | undefined;
  const rules: SpawnRules = {
    default: objects?.default === "block" ? "block" : "allow",
    items: {},
    blockedBehaviours: [],
  };
  for (const item of parseListedItems(objects)) rules.items[item.id] = item.allow;
  if (Array.isArray(objects?.blocked_behaviours)) {
    rules.blockedBehaviours = objects!.blocked_behaviours.filter(
      (b): b is string => typeof b === "string" && b.length <= 100
    );
  }
  const max = objects?.max_per_user ?? legacyCap;
  if (typeof max === "number" && Number.isFinite(max) && max >= 0) rules.maxPerUser = Math.floor(max);
  return rules;
}

/** Whether the world's rules let people spawn Item `id` (anything that isn't an Item is always allowed). */
export function isSpawnAllowed(rules: SpawnRules, id: string) {
  if (!isItemId(id)) return true;
  if (itemBehaviours(id).some((b) => rules.blockedBehaviours.includes(b))) return false;
  return rules.items[id] ?? rules.default !== "block";
}

/**
 * The rules event's `objects` for these settings. Also writes the old `allowed` (the stock Items allowed), so
 * clients from before lists still enforce the stock part, and the list again as `things`, its name before Items.
 */
export function serializeObjectRules(
  previous: unknown,
  rules: { default: "allow" | "block"; items: ListedItem[]; blockedBehaviours: string[] }
): Record<string, unknown> {
  const parsed: SpawnRules = {
    default: rules.default,
    items: Object.fromEntries(rules.items.map((t) => [t.id, t.allow])),
    blockedBehaviours: rules.blockedBehaviours,
  };
  return {
    ...(typeof previous === "object" && previous !== null ? previous : {}),
    default: rules.default,
    items: rules.items.slice(0, MAX_LISTED_ITEMS),
    // The same list under its name from before Things became Items, for clients that haven't updated yet.
    things: rules.items.slice(0, MAX_LISTED_ITEMS),
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
