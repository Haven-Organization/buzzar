/**
 * Buzzar: which game controller to play with (Settings → Controls), kept in this browser's localStorage.
 *
 * - "any": every connected controller works, merged (the default);
 * - "none": controllers are ignored (keyboard and mouse only);
 * - a particular one, remembered by its name (Gamepad.id) and slot (Gamepad.index), so with two identical pads the
 *   one you picked is used. If it isn't connected, no controller is used until it is (or another choice is made).
 */
export type GamepadChoice = { kind: "any" } | { kind: "none" } | { kind: "pad"; id: string; index: number };

export const GAMEPAD_CHOICE_KEY = "buzzar.gamepad.use";
const ANY: GamepadChoice = { kind: "any" };

let current: GamepadChoice | undefined;
const listeners = new Set<(choice: GamepadChoice) => void>();

export function parseGamepadChoice(value: unknown): GamepadChoice {
  if (typeof value !== "object" || value === null) return ANY;
  const record = value as Record<string, unknown>;
  if (record.kind === "none") return { kind: "none" };
  if (record.kind === "pad" && typeof record.id === "string" && Number.isInteger(record.index)) {
    return { kind: "pad", id: record.id, index: record.index as number };
  }
  return ANY;
}

export function getGamepadChoice(): GamepadChoice {
  if (!current) {
    try {
      current = parseGamepadChoice(JSON.parse(localStorage.getItem(GAMEPAD_CHOICE_KEY) ?? "null"));
    } catch {
      current = ANY;
    }
  }
  return current;
}

export function setGamepadChoice(choice: GamepadChoice) {
  current = choice;
  try {
    localStorage.setItem(GAMEPAD_CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // Not saved (private window, storage blocked): still applies until reload.
  }
  for (const listener of listeners) listener(choice);
}

export function onGamepadChoice(listener: (choice: GamepadChoice) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Another window of the app changed it.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (evt) => {
    if (evt.key !== GAMEPAD_CHOICE_KEY) return;
    current = undefined;
    const choice = getGamepadChoice();
    for (const listener of listeners) listener(choice);
  });
}

/** The connected pads to read, given the choice. */
export function pickGamepads<T extends { id: string; index: number }>(pads: T[], choice: GamepadChoice): T[] {
  if (choice.kind === "none") return [];
  if (choice.kind === "any") return pads;
  const same = pads.filter((pad) => pad.id === choice.id);
  const exact = same.find((pad) => pad.index === choice.index);
  return exact ? [exact] : same.slice(0, 1);
}
