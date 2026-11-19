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

export interface SpawnRules {
  /** Stock objects people may spawn; undefined = all of them. */
  allowed?: string[];
  /** Objects one person may have out at once; undefined = no limit beyond the world's max_member_object_cap. */
  maxPerUser?: number;
}

/** Parses the rules event's content (untrusted). */
export function parseSpawnRules(content: unknown, legacyCap?: unknown): SpawnRules {
  const rules: SpawnRules = {};
  const objects = (content as { objects?: unknown } | undefined)?.objects as
    | { allowed?: unknown; max_per_user?: unknown }
    | undefined;
  if (objects && Array.isArray(objects.allowed)) {
    rules.allowed = objects.allowed.filter((id): id is string => typeof id === "string").slice(0, 100);
  }
  const max = objects?.max_per_user ?? legacyCap;
  if (typeof max === "number" && Number.isFinite(max) && max >= 0) rules.maxPerUser = Math.floor(max);
  return rules;
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
