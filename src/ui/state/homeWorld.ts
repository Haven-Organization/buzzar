import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/** Buzzar: enter your Home World when Buzzar starts (Settings → Worlds; this browser). On by default. */
export const enterHomeOnStartupAtom = atomWithStorage("buzzar.enterHomeOnStartup", true);

/** Buzzar: whether you have a Home World, once checked at startup (hooks/useHomeWorld). */
export type HomeWorldState = { status: "checking" } | { status: "none" } | { status: "ready"; roomId: string };
export const homeWorldAtom = atom<HomeWorldState>({ status: "checking" });

/** Buzzar: "Skip for Now" on the welcome screen, for this session. */
export const homeWelcomeSkippedAtom = atom(false);
