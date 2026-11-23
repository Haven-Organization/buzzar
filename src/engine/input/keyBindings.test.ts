import { beforeEach, describe, expect, it } from "vitest";

import {
  actionForKey,
  engineKey,
  getKey,
  isActionKey,
  keyLabel,
  parseKeyBindings,
  resetAllKeys,
  resetKey,
  setKey,
} from "./keyBindings";

describe("key bindings (Third Room #382)", () => {
  beforeEach(() => resetAllKeys());

  it("starts on the default keys and passes every key through unchanged", () => {
    expect(getKey("jump")).toBe("Space");
    expect(engineKey("KeyW")).toBe("KeyW");
    expect(engineKey("ShiftRight")).toBe("ShiftRight");
    expect(engineKey("KeyQ")).toBe("KeyQ");
    expect(engineKey("Digit1")).toBe("Digit1");
  });

  it("sends a rebound key to the engine as the action's default key, and swallows the old one", () => {
    setKey("forward", "KeyI");
    expect(engineKey("KeyI")).toBe("KeyW");
    expect(engineKey("KeyW")).toBeNull();
    expect(engineKey("KeyS")).toBe("KeyS");
    // Keys no game action uses still pass through (action bar, editor, world scripts).
    expect(engineKey("Digit3")).toBe("Digit3");
    expect(engineKey("KeyF")).toBe("KeyF");
  });

  it("swaps two actions when a key is taken", () => {
    const swapped = setKey("jump", "KeyE");
    expect(swapped?.id).toBe("grab");
    expect(getKey("jump")).toBe("KeyE");
    expect(getKey("grab")).toBe("Space");
    expect(engineKey("KeyE")).toBe("Space");
    expect(engineKey("Space")).toBe("KeyE");
    expect(actionForKey("Space")?.id).toBe("grab");
  });

  it("moves both Shift keys off running when it's rebound", () => {
    setKey("run", "KeyG");
    expect(engineKey("KeyG")).toBe("ShiftLeft");
    expect(engineKey("ShiftLeft")).toBeNull();
    expect(engineKey("ShiftRight")).toBeNull();
    resetKey("run");
    expect(engineKey("ShiftRight")).toBe("ShiftRight");
  });

  it("keeps an interface key away from the game", () => {
    setKey("forward", "KeyI");
    setKey("map", "KeyW");
    expect(engineKey("KeyW")).toBeNull();
    const event = new KeyboardEvent("keydown", { code: "KeyW" });
    expect(isActionKey(event, "map")).toBe(true);
    expect(isActionKey(new KeyboardEvent("keydown", { code: "KeyW", ctrlKey: true }), "map")).toBe(false);
  });

  it("refuses reserved keys", () => {
    expect(() => setKey("jump", "Tab")).toThrow();
    expect(() => setKey("jump", "Digit1")).toThrow();
  });

  it("ignores unknown actions, reserved keys and clashes in saved bindings", () => {
    expect(parseKeyBindings({ jump: "KeyJ", nope: "KeyK", grab: "Escape" })).toEqual({ jump: "KeyJ" });
    // Two actions on one key: both dropped (back to their defaults).
    expect(parseKeyBindings({ jump: "KeyJ", grab: "KeyJ" })).toEqual({});
    expect(parseKeyBindings({ jump: "KeyW" })).toEqual({});
    expect(parseKeyBindings("junk")).toEqual({});
  });

  it("names keys", () => {
    expect(keyLabel("KeyW")).toBe("W");
    expect(keyLabel("Digit4")).toBe("4");
    expect(keyLabel("ShiftLeft")).toBe("Shift");
    expect(keyLabel("Backquote")).toBe("`");
    expect(keyLabel("Numpad8")).toBe("Num 8");
  });
});
