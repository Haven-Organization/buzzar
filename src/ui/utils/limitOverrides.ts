/**
 * Buzzar: the Developer settings that ignore world limits (engine/player/movement.common.ts LimitOverrides), kept in
 * this browser like the other developer settings, in the JSON form useLocalStorage reads.
 */
import { LIMIT_OVERRIDES_KEY, LimitOverrides } from "../../engine/player/movement.common";

export function setLimitOverrides(overrides: LimitOverrides) {
  try {
    localStorage.setItem(LIMIT_OVERRIDES_KEY, JSON.stringify(overrides));
    // Let open settings and the world (useLocalStorage) see it in this tab too.
    window.dispatchEvent(new CustomEvent("buzzar-local-storage", { detail: LIMIT_OVERRIDES_KEY }));
  } catch {
    // storage unavailable
  }
}
