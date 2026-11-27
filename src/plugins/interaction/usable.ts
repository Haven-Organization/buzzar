/**
 * Buzzar: Items that do something of their own while held (a water gun sprays, plugins/sprayers). While you hold one,
 * left click (UseHeld) and right click (PumpHeld) belong to it, and E (DropHeld) lets go; other Items keep left click
 * to let go and right click to throw.
 */
export const usableItems = new Set<number>();
