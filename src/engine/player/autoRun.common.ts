/**
 * Buzzar: Auto Run (Settings → Controls → Keyboard and Mouse). Walking with the keys runs, and holding Shift walks.
 * Controller sticks are unaffected: they have their own sprint button and walk slower part-way over.
 */
export const AutoRunMessage = "software.haven.settings.auto-run";
export interface AutoRunMessageData {
  type: typeof AutoRunMessage;
  enabled: boolean;
}
/** Whether to run this frame: Shift (flipped by Auto Run while moving with the keys), or a controller's sprint. */
export function isRunHeld(autoRunOn: boolean, shiftHeld: boolean, keysMoving: boolean, padSprintHeld: boolean) {
  if (padSprintHeld) return true;
  return autoRunOn ? keysMoving && !shiftHeld : shiftHeld;
}
