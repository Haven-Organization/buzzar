/**
 * Buzzar (Third Room #295): the world's movement rules, this player's own speed choices and the Developer-mode limit
 * overrides, as the game thread sees them (see movement.common.ts).
 */
import { defineModule, getModule, registerMessageHandler } from "../module/module.common";
import { GameContext } from "../GameTypes";
import { createDisposables } from "../utils/createDisposables";
import {
  DEFAULT_MOVEMENT,
  DEFAULT_MOVEMENT_PREFS,
  effectiveSpeeds,
  LimitOverrides,
  MovementMessageType,
  MovementPrefs,
  MovementRules,
  SetLimitOverridesMessage,
  SetMovementPrefsMessage,
  SetMovementRulesMessage,
} from "./movement.common";

interface MovementState {
  rules: MovementRules;
  prefs: MovementPrefs;
  overrides: LimitOverrides;
  listeners: Set<() => void>;
}

export const MovementModule = defineModule<GameContext, MovementState>({
  name: "movement",
  create() {
    return {
      rules: { ...DEFAULT_MOVEMENT },
      prefs: { ...DEFAULT_MOVEMENT_PREFS },
      overrides: { ignoreOwn: false, ignoreOthers: false },
      listeners: new Set(),
    };
  },
  init(ctx) {
    const changed = () => {
      for (const listener of getModule(ctx, MovementModule).listeners) listener();
    };
    return createDisposables([
      registerMessageHandler(ctx, MovementMessageType.SetMovementRules, (ctx, message: SetMovementRulesMessage) => {
        getModule(ctx, MovementModule).rules = message.rules;
        changed();
      }),
      registerMessageHandler(ctx, MovementMessageType.SetMovementPrefs, (ctx, message: SetMovementPrefsMessage) => {
        getModule(ctx, MovementModule).prefs = message.prefs;
      }),
      registerMessageHandler(ctx, MovementMessageType.SetLimitOverrides, (ctx, message: SetLimitOverridesMessage) => {
        getModule(ctx, MovementModule).overrides = message.overrides;
        changed();
      }),
    ]);
  },
});

export function getMovementRules(ctx: GameContext): MovementRules {
  return getModule(ctx, MovementModule).rules;
}

const NO_OVERRIDES: LimitOverrides = { ignoreOwn: false, ignoreOthers: false };

/** The Developer limit overrides (off where the module isn't loaded, e.g. in tests). */
export function getLimitOverrides(ctx: GameContext): LimitOverrides {
  return getModule(ctx, MovementModule)?.overrides ?? NO_OVERRIDES;
}

/** Called when the world's movement rules or the limit overrides change. */
export function onMovementRulesChanged(ctx: GameContext, listener: () => void) {
  const { listeners } = getModule(ctx, MovementModule);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The speeds our player moves at now (m/s). */
export function ourSpeeds(ctx: GameContext) {
  const { rules, prefs, overrides } = getModule(ctx, MovementModule);
  return effectiveSpeeds(rules, prefs, overrides.ignoreOwn);
}

/** Whether our player may switch to flying. */
export function mayFly(ctx: GameContext) {
  const { rules, overrides } = getModule(ctx, MovementModule);
  return rules.fly || overrides.ignoreOwn;
}

export function jumpScale(ctx: GameContext) {
  const { rules, overrides } = getModule(ctx, MovementModule);
  return overrides.ignoreOwn ? Math.max(1, rules.jump) : rules.jump;
}

/** Flying speed and boost for our player (m/s, multiplier). */
export function ourFlySpeed(ctx: GameContext) {
  const { rules } = getModule(ctx, MovementModule);
  return { speed: rules.flySpeed, boost: rules.flyBoost };
}
