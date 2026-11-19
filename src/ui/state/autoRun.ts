import { atomWithStorage } from "jotai/utils";

/** Buzzar: Auto Run (Settings → Controls): walking with the keys runs, and holding Shift walks. Kept per device. */
export const autoRunAtom = atomWithStorage("buzzar.autoRun", false);
