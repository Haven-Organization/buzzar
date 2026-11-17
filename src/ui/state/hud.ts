import { atom } from "jotai";

/**
 * Buzzar: the player pressed H to hide the HUD (top bar, hotbar, bottom-right controls, chat hint), for screenshots
 * and a clean view, like VRChat's Ctrl+H. The overlay, chat and nametags still show. Resets on leaving the world.
 */
export const hudHiddenAtom = atom<boolean>(false);
