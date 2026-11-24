/**
 * Buzzar (Third Room #382): rebindable keys (Settings → Controls), kept in this browser's localStorage.
 *
 * Keys are physical key codes (KeyboardEvent.code, e.g. "KeyW"), so they stay in the same place on any keyboard layout.
 *
 * - Game actions (moving, jumping, grabbing…) are bound in the game thread to their default keys. Rather than rebuild
 *   those bindings, the keyboard is remapped where it enters the engine (input.main.ts): a key you bound to an action
 *   is passed on as that action's default key, and a default key you moved elsewhere is swallowed. Scripts in worlds
 *   see the same remapped keys.
 * - Interface shortcuts (mute, names, map…) read their key from here directly.
 *
 * Every key belongs to at most one action: binding a key that's taken swaps the two actions' keys. A few keys stay
 * fixed (Tab, Escape, Enter, the number keys…), since other parts of the app or the browser rely on them.
 *
 * A binding can include Ctrl and/or Alt ("Alt+KeyS", "Ctrl+KeyF"): a key pressed with them is a separate input from
 * the key alone. Shift isn't a modifier here (it's the Run key). Combinations reach the game only when a game action
 * is bound to one; browser and app shortcuts (Ctrl+W, Alt+Tab, Alt+←…) can't be bound.
 */

export type KeyActionGroup = "move" | "actions" | "interface";

export interface KeyAction {
  id: string;
  label: string;
  group: KeyActionGroup;
  defaultKey: string;
  /** A game-thread action: remapped on the way into the engine. Otherwise the UI handles it. */
  engine?: boolean;
  /** Other default keys for the same action (e.g. the right Shift for running). */
  alsoDefault?: string[];
}

export const KEY_ACTIONS: KeyAction[] = [
  { id: "forward", label: "Move Forward", group: "move", defaultKey: "KeyW", engine: true },
  { id: "back", label: "Move Back", group: "move", defaultKey: "KeyS", engine: true },
  { id: "left", label: "Move Left", group: "move", defaultKey: "KeyA", engine: true },
  { id: "right", label: "Move Right", group: "move", defaultKey: "KeyD", engine: true },
  {
    id: "run",
    label: "Run (walk with Auto Run on)",
    group: "move",
    defaultKey: "ShiftLeft",
    engine: true,
    alsoDefault: ["ShiftRight"],
  },
  { id: "jump", label: "Jump", group: "move", defaultKey: "Space", engine: true },
  { id: "crouch", label: "Crouch (hold to go prone)", group: "move", defaultKey: "KeyC", engine: true },
  { id: "prone", label: "Prone", group: "move", defaultKey: "KeyZ", engine: true },
  { id: "fly", label: "Fly Mode", group: "move", defaultKey: "KeyB", engine: true },
  { id: "camera", label: "Third Person Camera", group: "move", defaultKey: "KeyV", engine: true },
  { id: "grab", label: "Grab / Use / Drop", group: "actions", defaultKey: "KeyE", engine: true },
  {
    id: "straighten",
    label: "Straighten Held Object (tap) / Rotate It (hold, move the mouse)",
    group: "actions",
    defaultKey: "KeyR",
    engine: true,
  },
  { id: "delete", label: "Delete Object", group: "actions", defaultKey: "KeyX", engine: true },
  { id: "mute", label: "Mute / Unmute", group: "interface", defaultKey: "KeyM" },
  { id: "names", label: "Names: banners / names only / hidden", group: "interface", defaultKey: "KeyN" },
  { id: "people", label: "People", group: "interface", defaultKey: "KeyP" },
  { id: "map", label: "World Map", group: "interface", defaultKey: "KeyO" },
  { id: "hud", label: "Hide / Show the HUD", group: "interface", defaultKey: "KeyH" },
  { id: "controls", label: "Controls Help", group: "interface", defaultKey: "Slash" },
  { id: "screenshare", label: "Share Your Screen", group: "interface", defaultKey: "Alt+KeyS" },
  { id: "fullscreen", label: "Fullscreen", group: "interface", defaultKey: "Ctrl+KeyF" },
  { id: "xr", label: "Enter XR", group: "interface", defaultKey: "Alt+KeyX" },
  { id: "leave", label: "Leave the World", group: "interface", defaultKey: "Alt+KeyL" },
  { id: "editor", label: "Scene Editor", group: "interface", defaultKey: "Backquote" },
];

export type KeyActionId = (typeof KEY_ACTIONS)[number]["id"];

/** Keys that can't be bound: the app, the editor or the browser need them. */
export const RESERVED_KEYS = new Set([
  "Tab",
  "Escape",
  "Enter",
  "NumpadEnter",
  "KeyF", // editor: focus the selection
  "MetaLeft",
  "MetaRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ContextMenu",
  "CapsLock",
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`), // Things on the action bar
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
]);

export const KEY_BINDINGS_KEY = "buzzar.keyBindings";

/** Keys that are only modifiers: never bindable on their own here (Shift is: it's Run). */
const MODIFIER_KEYS = new Set(["ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"]);

/** Combinations the browser, the desktop app or the system use. */
const RESERVED_COMBOS = new Set([
  ...["KeyW", "KeyT", "KeyN", "KeyQ", "KeyR", "KeyL", "KeyC", "KeyV", "KeyX", "KeyA", "KeyZ", "KeyY", "Tab"].map(
    (key) => `Ctrl+${key}`
  ),
  "Alt+Tab",
  "Alt+F4",
  "Alt+ArrowLeft",
  "Alt+ArrowRight",
  "Alt+Space",
]);
/** Keys never used in a combination. */
const RESERVED_COMBO_BASES = new Set(["Tab", "Escape", "Enter", "NumpadEnter"]);

/** Splits a binding into its modifiers and key: "Ctrl+Alt+KeyS" → { ctrl: true, alt: true, key: "KeyS" }. */
export function parseBinding(binding: string): { ctrl: boolean; alt: boolean; key: string } {
  let rest = binding;
  const ctrl = rest.startsWith("Ctrl+");
  if (ctrl) rest = rest.slice(5);
  const alt = rest.startsWith("Alt+");
  if (alt) rest = rest.slice(4);
  return { ctrl, alt, key: rest };
}

/** A key event as a binding ("KeyS", "Alt+KeyS", "Ctrl+Alt+KeyS"); undefined for a modifier key pressed alone. */
export function bindingOf(event: { code: string; ctrlKey: boolean; altKey: boolean }): string | undefined {
  if (!event.code || MODIFIER_KEYS.has(event.code)) return undefined;
  return `${event.ctrlKey ? "Ctrl+" : ""}${event.altKey ? "Alt+" : ""}${event.code}`;
}

/** Whether a binding can't be used (the app or browser needs it), or isn't a valid one. */
export function isReservedBinding(binding: string): boolean {
  const { ctrl, alt, key } = parseBinding(binding);
  if (!/^[A-Za-z0-9]{1,24}$/.test(key) || MODIFIER_KEYS.has(key)) return true;
  if (!ctrl && !alt) return RESERVED_KEYS.has(key);
  return RESERVED_COMBOS.has(binding) || RESERVED_COMBO_BASES.has(key);
}

const byId = new Map(KEY_ACTIONS.map((action) => [action.id, action]));
let overrides: Record<string, string> | undefined;
let remap: Map<string, string | null> | undefined;
const listeners = new Set<() => void>();

/** Only known actions and bindable keys; a key used twice keeps its first action. */
export function parseKeyBindings(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof value !== "object" || value === null) return result;
  for (const [id, key] of Object.entries(value as Record<string, unknown>)) {
    const action = byId.get(id);
    if (!action || typeof key !== "string" || isReservedBinding(key)) continue;
    if (key !== action.defaultKey) result[id] = key;
  }
  // Drop any binding whose key another action also ends up with.
  const owners = new Map<string, string[]>();
  for (const action of KEY_ACTIONS) {
    const key = result[action.id] ?? action.defaultKey;
    owners.set(key, [...(owners.get(key) ?? []), action.id]);
  }
  for (const ids of owners.values()) {
    if (ids.length > 1) for (const id of ids) delete result[id];
  }
  return result;
}

function load(): Record<string, string> {
  if (!overrides) {
    try {
      overrides = parseKeyBindings(JSON.parse(localStorage.getItem(KEY_BINDINGS_KEY) ?? "null"));
    } catch {
      overrides = {};
    }
  }
  return overrides;
}

/** The key an action is bound to now. */
export function getKey(id: KeyActionId): string {
  return load()[id] ?? byId.get(id)?.defaultKey ?? "";
}

export function getKeyBindings(): Record<string, string> {
  return Object.fromEntries(KEY_ACTIONS.map((action) => [action.id, getKey(action.id)]));
}

export function isCustomised(id?: KeyActionId) {
  return id ? id in load() : Object.keys(load()).length > 0;
}

/** The action using a key, if any. */
export function actionForKey(key: string): KeyAction | undefined {
  return KEY_ACTIONS.find((action) => getKey(action.id) === key);
}

function save(next: Record<string, string>) {
  overrides = parseKeyBindings(next);
  remap = undefined;
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(KEY_BINDINGS_KEY);
    else localStorage.setItem(KEY_BINDINGS_KEY, JSON.stringify(overrides));
  } catch {
    // Not saved (private window, storage blocked): still applies until reload.
  }
  for (const listener of listeners) listener();
}

/**
 * Binds an action to a key. If another action had that key, the two swap. Returns the action that was swapped, if
 * any, or throws for a key that can't be bound.
 */
export function setKey(id: KeyActionId, key: string): KeyAction | undefined {
  if (!byId.has(id)) throw new Error(`Unknown action ${id}`);
  if (isReservedBinding(key)) throw new Error(`${keyLabel(key)} can't be used: it's needed elsewhere.`);
  const current = getKey(id);
  if (current === key) return undefined;
  const other = actionForKey(key);
  const next = { ...load() };
  next[id] = key;
  if (other) next[other.id] = current;
  for (const action of KEY_ACTIONS) {
    if (next[action.id] === action.defaultKey) delete next[action.id];
  }
  save(next);
  return other;
}

export function resetKey(id: KeyActionId) {
  const action = byId.get(id);
  if (!action) return undefined;
  return setKey(id, action.defaultKey);
}

export function resetAllKeys() {
  save({});
}

export function onKeyBindings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * For the engine: the key code to pass on for a key press (a binding: "KeyW", or "Alt+KeyW" with modifiers), `null` to
 * swallow it (a game action's default key whose action moved, or a combination no game action is bound to), or the
 * key itself when no game action is involved.
 */
export function engineKey(code: string): string | null {
  if (!remap) {
    remap = new Map();
    const bindings = load();
    const custom = Object.keys(bindings).length > 0;
    if (custom) {
      // Default keys of game actions are swallowed unless something is bound to them…
      for (const action of KEY_ACTIONS) {
        if (!action.engine) continue;
        for (const key of [action.defaultKey, ...(action.alsoDefault ?? [])]) remap.set(key, null);
      }
      // …and every game action's key is passed on as its default key.
      for (const action of KEY_ACTIONS) {
        if (!action.engine) continue;
        remap.set(getKey(action.id), action.defaultKey);
        if (!(action.id in bindings)) for (const key of action.alsoDefault ?? []) remap.set(key, key);
      }
    }
  }
  const mapped = remap.get(code);
  if (mapped !== undefined) return mapped;
  // Combinations only reach the game when a game action is bound to one: Alt+S is never also S.
  const { ctrl, alt } = parseBinding(code);
  return ctrl || alt ? null : code;
}

/**
 * Whether a key event is the binding for an action (with exactly its Ctrl/Alt; never with Meta). A Ctrl/Alt binding
 * doesn't fire with Shift held too (Ctrl + Shift + S is the statistics, not Ctrl + S); plain keys do (Shift is Run).
 */
export function isActionKey(event: KeyboardEvent, id: KeyActionId) {
  if (event.metaKey) return false;
  if ((event.ctrlKey || event.altKey) && event.shiftKey) return false;
  return bindingOf(event) === getKey(id);
}

const KEY_NAMES: Record<string, string> = {
  Space: "Space",
  ShiftLeft: "Shift",
  ShiftRight: "Right Shift",
  Backquote: "`",
  Slash: "/",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "Page Up",
  PageDown: "Page Down",
  IntlBackslash: "\\",
};

/** How a binding is shown: "KeyW" → "W", "Numpad4" → "Num 4", "ShiftLeft" → "Shift", "Alt+KeyS" → "Alt + S". */
export function keyLabel(binding: string): string {
  const { ctrl, alt, key } = parseBinding(binding);
  return [...(ctrl ? ["Ctrl"] : []), ...(alt ? ["Alt"] : []), singleKeyLabel(key)].join(" + ");
}

function singleKeyLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  return code;
}

/** The label of the key an action is bound to now. */
export function actionKeyLabel(id: KeyActionId) {
  return keyLabel(getKey(id));
}

// Another window of the app changed them.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (evt) => {
    if (evt.key !== KEY_BINDINGS_KEY) return;
    overrides = undefined;
    remap = undefined;
    for (const listener of listeners) listener();
  });
}
