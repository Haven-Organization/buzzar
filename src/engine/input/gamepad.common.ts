/**
 * Buzzar: gamepad support (parity checklist §3b), the parts shared by the main thread (polling) and the game
 * (bindings). Uses the W3C "standard" mapping: Xbox-style layout, PlayStation and Switch pads map the same way.
 */

/** Standard-mapping button indices. */
export const PadButton = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  Back: 8,
  Start: 9,
  L3: 10,
  R3: 11,
  DpadUp: 12,
  DpadDown: 13,
  DpadLeft: 14,
  DpadRight: 15,
  /** Not a real button: on while the left stick is pushed nearly all the way (sprint). */
  Sprint: 100,
} as const;

/** Raw input path of a gamepad button, for action bindings. */
export const padButton = (index: number) => `Gamepad/button/${index}`;
export const PAD_LEFT_X = "Gamepad/leftStick/x-axis";
/** Up is +1, like W. */
export const PAD_LEFT_Y = "Gamepad/leftStick/y-axis";

/** Sticks report nothing inside this radius (worn sticks drift a little). */
export const STICK_DEADZONE = 0.18;
/** Left stick past this sprints. */
export const SPRINT_THRESHOLD = 0.92;

/**
 * A stick's position with a radial dead zone, rescaled so movement starts smoothly from the edge of the dead zone and
 * reaches 1 at full tilt.
 */
export function applyDeadzone(x: number, y: number, deadzone = STICK_DEADZONE): [number, number] {
  const length = Math.hypot(x, y);
  if (length <= deadzone) return [0, 0];
  const scaled = Math.min(1, (length - deadzone) / (1 - deadzone));
  return [(x / length) * scaled, (y / length) * scaled];
}

/** Look response: squared, so small tilts aim finely and full tilt still turns fast. */
export function lookCurve(v: number) {
  return Math.sign(v) * v * v;
}

/** Right stick at full tilt turns the view this many mouse units a second (about 600 units = 90°). */
export const LOOK_SPEED = 1100;
