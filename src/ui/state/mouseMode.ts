import { atom } from "jotai";

/**
 * Buzzar: the player pressed Tab to free the mouse. "Click to play" shows until they click the world, and opening or
 * closing the overlay, chat or editor keeps this mode.
 */
export const mouseFreedAtom = atom<boolean>(false);

/**
 * Buzzar: the player went back to the game (closed the overlay, chat or editor) but the browser didn't give the mouse
 * back, e.g. because Escape doesn't count as a user gesture. "Click to play" shows until the mouse is captured.
 */
export const awaitingLockAtom = atom<boolean>(false);
