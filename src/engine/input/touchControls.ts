/**
 * Buzzar (Third Room #156): on-screen touch controls for phones and tablets.
 *
 * The controls (ui/views/session/touch-controls) act as a virtual gamepad: the joystick is its left stick, the buttons
 * are its buttons, and dragging to look adds mouse movement. gamepad.main.ts reads `virtualPad` with the real pads, so
 * touch goes through the same bindings (jump, crouch, grab…) and the same checks (nothing happens behind a menu).
 *
 * Setting (Settings → Controls), kept in this browser: "auto" (the default) shows them on phones and tablets, "on" and
 * "off" force them.
 */

export type TouchControlsSetting = "auto" | "on" | "off";

export const TOUCH_CONTROLS_KEY = "buzzar.touchControls";

/** Whether this looks like a phone or tablet browser (touch is its main input). */
export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData?.mobile) return true;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini|IEMobile/i.test(ua)) return true;
  // iPadOS reports itself as a Mac; a Mac with a touch screen is an iPad.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}

let setting: TouchControlsSetting | undefined;
const listeners = new Set<() => void>();

export function getTouchControlsSetting(): TouchControlsSetting {
  if (!setting) {
    try {
      const value = localStorage.getItem(TOUCH_CONTROLS_KEY);
      setting = value === "on" || value === "off" ? value : "auto";
    } catch {
      setting = "auto";
    }
  }
  return setting;
}

export function setTouchControlsSetting(value: TouchControlsSetting) {
  setting = value;
  try {
    if (value === "auto") localStorage.removeItem(TOUCH_CONTROLS_KEY);
    else localStorage.setItem(TOUCH_CONTROLS_KEY, value);
  } catch {
    // Not saved (private window, storage blocked): still applies until reload.
  }
  for (const listener of listeners) listener();
}

export function touchControlsEnabled(value = getTouchControlsSetting()): boolean {
  return value === "on" || (value === "auto" && isMobileBrowser());
}

export function onTouchControlsSetting(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The on-screen controls' state, read by the gamepad poll (gamepad.main.ts). */
export const virtualPad = {
  /** Joystick, -1…1, up is -1 like a real stick's y axis. */
  stick: [0, 0] as [number, number],
  /** Pressed buttons (standard-mapping indices, see PadButton). */
  buttons: new Map<number, number>(),
  /** Look movement not sent yet (mouse units). */
  look: [0, 0] as [number, number],
};

export function resetVirtualPad() {
  virtualPad.stick = [0, 0];
  virtualPad.buttons.clear();
  virtualPad.look = [0, 0];
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (evt) => {
    if (evt.key !== TOUCH_CONTROLS_KEY) return;
    setting = undefined;
    for (const listener of listeners) listener();
  });
}
