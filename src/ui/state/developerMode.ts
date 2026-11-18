import { atomWithStorage } from "jotai/utils";

/**
 * Buzzar: Developer Mode (Settings → Developer), kept in this browser's localStorage. It shows tools meant for world
 * builders and testing, e.g. "Enter Without Script" in a world's menu, and the experimental features.
 */
export const developerModeAtom = atomWithStorage("buzzar.developerMode", false);
