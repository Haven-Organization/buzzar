/**
 * Buzzar: polls connected gamepads (every 8 ms) and feeds them into the same input ring buffer as the keyboard and
 * mouse (parity checklist §3b). All connected pads are merged, so any of them works.
 *
 * - Buttons become raw `Gamepad/button/<index>` input (standard mapping), bound to actions in the game like keys.
 * - The left stick becomes `Gamepad/leftStick/x-axis` / `y-axis` (up is +1); pushing it nearly all the way presses a
 *   virtual Sprint button.
 * - The right stick turns the view by sending mouse movement, so look sensitivity and smoothing are shared.
 * - Buttons for things the page handles (menu, mute, names, HUD, controls help) press those keyboard shortcuts.
 *
 * Browsers only list a pad after one of its buttons is pressed while the page has focus. Settings → Controls picks which
 * pads are read (gamepadPreference.ts).
 */
import { applyDeadzone, LOOK_SPEED, lookCurve, PadButton, SPRINT_THRESHOLD } from "./gamepad.common";
import { getGamepadChoice, pickGamepads } from "./gamepadPreference";
import { InputComponentId, InputSourceId } from "./input.common";

export type Enqueue = (
  inputSourceId: number,
  componentId: number,
  button: number,
  xAxis: number,
  yAxis: number,
  zAxis: number,
  wAxis: number,
  state: number
) => void;

/** Buttons that press a page shortcut instead of going to the game: [button, KeyboardEvent code, key]. */
const SHORTCUTS: [number, string, string][] = [
  [PadButton.Start, "Tab", "Tab"],
  [PadButton.Y, "KeyM", "m"],
  [PadButton.DpadUp, "KeyN", "n"],
  [PadButton.DpadDown, "KeyH", "h"],
  [PadButton.Back, "Slash", "/"],
];
/** How often pads are read (ms): fast enough that even a quick tap is seen. */
const POLL_INTERVAL_MS = 8;

const SHORTCUT_BUTTONS = new Set(SHORTCUTS.map(([button]) => button));

function pressShortcut(code: string, key: string) {
  // A menu may have put focus in a text field (e.g. the Worlds filter), where Tab and letter keys are left alone for
  // typing. Someone pressing a pad button isn't typing, so take focus off it first.
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
  for (const type of ["keydown", "keyup"]) {
    window.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true }));
  }
}

/**
 * Starts polling. `enqueue` sends to the game; `active()` says whether game input is wanted right now (no menu or
 * text field in the way). Releases and sticks returning to rest are always sent, so nothing stays held. Returns a
 * function that stops polling.
 */
export function startGamepadPolling(enqueue: Enqueue, active: () => boolean): () => void {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return () => {};

  const buttons = new Map<number, number>();
  let left: [number, number] = [0, 0];
  let last = performance.now();

  const sendButton = (index: number, value: number) => {
    if ((buttons.get(index) ?? 0) === value) return;
    if (value > 0 && !active()) return;
    buttons.set(index, value);
    enqueue(InputSourceId.Gamepad, InputComponentId.GamepadButton, value, 0, 0, 0, 0, index);
  };

  const poll = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    const connected = Array.from(navigator.getGamepads?.() ?? []).filter(
      (pad): pad is Gamepad => !!pad && pad.connected
    );
    const pads = pickGamepads(connected, getGamepadChoice());

    // Buttons: the strongest press across pads. Buttons held when a pad stops being read (unplugged, or another
    // controller picked) are released too.
    const held = [...buttons.keys()].filter((index) => index !== PadButton.Sprint);
    const count = Math.max(0, ...pads.map((pad) => pad.buttons.length), ...held.map((index) => index + 1));
    for (let i = 0; i < count; i++) {
      let value = 0;
      for (const pad of pads) {
        const b = pad.buttons[i];
        if (b) value = Math.max(value, b.pressed ? Math.max(b.value, 1) : b.value);
      }
      value = Math.round(value * 100) / 100;
      if (SHORTCUT_BUTTONS.has(i)) {
        const was = buttons.get(i) ?? 0;
        buttons.set(i, value);
        if (was < 0.5 && value >= 0.5) {
          const shortcut = SHORTCUTS.find(([button]) => button === i)!;
          pressShortcut(shortcut[1], shortcut[2]);
        }
        continue;
      }
      sendButton(i, value);
    }

    // Sticks: the pad pushed furthest.
    let lx = 0;
    let ly = 0;
    let rx = 0;
    let ry = 0;
    for (const pad of pads) {
      const [ax = 0, ay = 0, bx = 0, by = 0] = pad.axes;
      if (Math.hypot(ax, ay) > Math.hypot(lx, ly)) [lx, ly] = [ax, ay];
      if (Math.hypot(bx, by) > Math.hypot(rx, ry)) [rx, ry] = [bx, by];
    }

    const [mx, my] = applyDeadzone(lx, ly);
    const nextLeft: [number, number] = [Math.round(mx * 100) / 100, Math.round(-my * 100) / 100];
    if (nextLeft[0] !== left[0] || nextLeft[1] !== left[1]) {
      const resting = nextLeft[0] === 0 && nextLeft[1] === 0;
      if (resting || active()) {
        left = nextLeft;
        enqueue(InputSourceId.Gamepad, InputComponentId.GamepadStick, 0, left[0], left[1], 0, 0, 0);
      }
    }
    sendButton(PadButton.Sprint, Math.hypot(mx, my) >= SPRINT_THRESHOLD ? 1 : 0);

    const [lookX, lookY] = applyDeadzone(rx, ry);
    if ((lookX !== 0 || lookY !== 0) && active()) {
      const speed = LOOK_SPEED * dt;
      enqueue(
        InputSourceId.Mouse,
        InputComponentId.MouseMovement,
        0,
        lookCurve(lookX) * speed,
        lookCurve(lookY) * speed,
        0,
        0,
        0
      );
    }
  };
  // A timer rather than animation frames: the Gamepad API only reports the current state, so a quick tap between two
  // samples would be missed, and frames can be slow or throttled (busy main thread, occluded window).
  const timer = window.setInterval(poll, POLL_INTERVAL_MS);

  return () => window.clearInterval(timer);
}
