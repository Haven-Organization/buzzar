/**
 * Buzzar: what floats above people. N cycles: names and banners → names only → nothing.
 */
import { useLocalStorage } from "../hooks/useLocalStorage";

export type NameMode = "all" | "names" | "off";

const NAME_MODE_STORE = "nameDisplay";
/** Third Room's old on/off setting, used once to pick the starting mode. */
const LEGACY_SHOW_NAMES_STORE = "showNames";

function initialNameMode(): NameMode {
  try {
    return localStorage.getItem(LEGACY_SHOW_NAMES_STORE) === "false" ? "off" : "all";
  } catch {
    return "all";
  }
}

export function useNameMode() {
  return useLocalStorage<NameMode>(NAME_MODE_STORE, initialNameMode());
}

export function nextNameMode(mode: NameMode): NameMode {
  return mode === "all" ? "names" : mode === "names" ? "off" : "all";
}

export const NAME_MODE_LABEL: Record<NameMode, string> = {
  all: "Names and Banners",
  names: "Names Only",
  off: "Names Hidden",
};
