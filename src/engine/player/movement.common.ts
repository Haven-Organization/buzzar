/**
 * Buzzar (Third Room #295): how fast players move in a world, and the limits other players' clients hold them to.
 *
 * - The world sets walk and run speeds, the top speed players may choose, jump strength and whether flying is
 *   allowed (World Settings → Movement, kept in the rules event's `movement`). Worlds that don't care get the defaults.
 * - Players choose their own walk and run speed and their controller's top speed (Settings → Controls), as a share
 *   of the world's speeds, never above the world's top speed.
 * - Every client holds other players to the world's limits (movementCheck.game.ts): someone moving faster than the
 *   world allows lags behind on everyone else's screen, and moderators hear about it.
 *
 * Matrix events reject fractions, so speeds are kept in centimetres per second and jump as a percentage.
 */

export interface MovementRules {
  /** Walking speed, m/s. */
  walkSpeed: number;
  /** Running speed, m/s. */
  runSpeed: number;
  /** The fastest players may choose to walk or run, m/s (and what other clients allow). */
  maxSpeed: number;
  /** Jump height (1 = normal, 2 = twice as high, 0 = no jumping). */
  jump: number;
  /** Whether players may fly (the fly toggle). */
  fly: boolean;
  /** Flying speed, m/s. */
  flySpeed: number;
  /** How much faster flying with boost held is (1 = no boost). */
  flyBoost: number;
}

/** Flying (FlyCharacterController) by default: m/s, doubled while boosting. */
export const FLY_SPEED = 10;
export const FLY_BOOST = 2;

/** Buzzar's long-standing speeds (2 m/s walking, 5 running); players may choose up to 10. */
export const DEFAULT_MOVEMENT: MovementRules = {
  walkSpeed: 2,
  runSpeed: 5,
  maxSpeed: 10,
  jump: 1,
  fly: true,
  flySpeed: FLY_SPEED,
  flyBoost: FLY_BOOST,
};

const MAX_SETTABLE_SPEED = 50;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const speedFromCm = (value: unknown, fallback: number) =>
  finite(value) && value > 0 ? Math.min(MAX_SETTABLE_SPEED, value / 100) : fallback;

/** A world's movement rules, from its (untrusted) rules event content. */
export function parseMovementRules(rulesContent: unknown): MovementRules {
  const m = (rulesContent as { movement?: Record<string, unknown> } | undefined)?.movement;
  if (typeof m !== "object" || m === null) return { ...DEFAULT_MOVEMENT };
  const walkSpeed = speedFromCm(m.walk_cm_s, DEFAULT_MOVEMENT.walkSpeed);
  const runSpeed = Math.max(walkSpeed, speedFromCm(m.run_cm_s, DEFAULT_MOVEMENT.runSpeed));
  const maxSpeed = Math.max(runSpeed, speedFromCm(m.max_cm_s, Math.max(runSpeed, DEFAULT_MOVEMENT.maxSpeed)));
  const jump = finite(m.jump_percent) && m.jump_percent >= 0 ? Math.min(5, m.jump_percent / 100) : 1;
  const flySpeed = speedFromCm(m.fly_cm_s, FLY_SPEED);
  const flyBoost =
    finite(m.fly_boost_percent) && m.fly_boost_percent >= 100 ? Math.min(5, m.fly_boost_percent / 100) : FLY_BOOST;
  return { walkSpeed, runSpeed, maxSpeed, jump, fly: m.fly !== false, flySpeed, flyBoost };
}

/** For the rules event (whole numbers only). */
export function serializeMovementRules(rules: MovementRules) {
  return {
    walk_cm_s: Math.round(rules.walkSpeed * 100),
    run_cm_s: Math.round(rules.runSpeed * 100),
    max_cm_s: Math.round(rules.maxSpeed * 100),
    jump_percent: Math.round(rules.jump * 100),
    fly: rules.fly,
    fly_cm_s: Math.round(rules.flySpeed * 100),
    fly_boost_percent: Math.round(rules.flyBoost * 100),
  };
}

/** A player's own choices (Settings → Controls), as shares of the world's speeds. */
export interface MovementPrefs {
  walk: number;
  run: number;
  /** A controller stick pushed all the way: this share of the run speed. */
  controller: number;
}

export const DEFAULT_MOVEMENT_PREFS: MovementPrefs = { walk: 1, run: 1, controller: 1 };
export const MOVEMENT_PREFS_KEY = "buzzar.movementPrefs";
export const MIN_PREF = 0.5;
export const MAX_PREF = 3;

export function parseMovementPrefs(value: unknown): MovementPrefs {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const share = (x: unknown) => (finite(x) ? Math.min(MAX_PREF, Math.max(MIN_PREF, x)) : 1);
  return { walk: share(v.walk), run: share(v.run), controller: share(v.controller) };
}

/**
 * The speeds this player actually moves at: their choices applied to the world's speeds, never past its top speed
 * (unless they've turned on "Ignore world limits for my actions" in Developer settings).
 */
export function effectiveSpeeds(rules: MovementRules, prefs: MovementPrefs, ignoreLimits = false) {
  const cap = ignoreLimits ? MAX_SETTABLE_SPEED : rules.maxSpeed;
  return {
    walk: Math.min(cap, rules.walkSpeed * prefs.walk),
    run: Math.min(cap, rules.runSpeed * prefs.run),
    controller: Math.min(cap, rules.runSpeed * prefs.controller),
  };
}

/** The fastest other players may be seen moving across the ground (m/s): the world's top speed, or flying's. */
export function allowedSpeed(rules: MovementRules) {
  return rules.fly ? Math.max(rules.maxSpeed, rules.flySpeed * rules.flyBoost) : rules.maxSpeed;
}

export enum MovementMessageType {
  SetMovementRules = "set-movement-rules",
  SetMovementPrefs = "set-movement-prefs",
  SetLimitOverrides = "set-limit-overrides",
}

export interface SetMovementRulesMessage {
  type: MovementMessageType.SetMovementRules;
  rules: MovementRules;
}

export interface SetMovementPrefsMessage {
  type: MovementMessageType.SetMovementPrefs;
  prefs: MovementPrefs;
}

/**
 * Developer settings: "Ignore world limits for my actions" (this client lets you break the world's rules; others
 * still block what you do) and "Don't enforce world limits on others for me" (this client shows what others send even
 * when it breaks the rules). Ownership checks (you can't move or delete someone else's things) always stay on.
 */
export interface LimitOverrides {
  ignoreOwn: boolean;
  ignoreOthers: boolean;
}

export const LIMIT_OVERRIDES_KEY = "buzzar.limitOverrides";

export interface SetLimitOverridesMessage {
  type: MovementMessageType.SetLimitOverrides;
  overrides: LimitOverrides;
}
