import { describe, expect, it } from "vitest";

import { ActionType, BindingType, ButtonActionState } from "./ActionMap";
import { ActionTypesToBindings } from "./ActionMappingSystem";
import { GameInputModule } from "./input.game";

const button = ActionTypesToBindings[ActionType.Button];
const bindings = [{ type: BindingType.Button as const, path: "XRInputSource/primary/xr-standard-trigger" }];

function step(state: ButtonActionState, value: number) {
  const input = { raw: { "XRInputSource/primary/xr-standard-trigger": value } } as unknown as GameInputModule;
  button.reduce(input, bindings, state);
  return { ...state };
}

describe("button actions", () => {
  it("a key press is pressed, held, then released", () => {
    const state = button.create();
    expect(step(state, 1)).toEqual({ pressed: true, released: false, held: true });
    expect(step(state, 1)).toEqual({ pressed: false, released: false, held: true });
    expect(step(state, 0)).toEqual({ pressed: false, released: true, held: false });
  });

  it("an analog trigger jittering near zero never presses", () => {
    const state = button.create();
    for (const v of [0.02, 0.1, 0.04, 0.2, 0.05]) expect(step(state, v).held).toBe(false);
  });

  it("an analog trigger hovering around the press point doesn't flicker", () => {
    const state = button.create();
    expect(step(state, 0.7).pressed).toBe(true);
    let releases = 0;
    for (const v of [0.55, 0.65, 0.5, 0.62, 0.45]) if (step(state, v).released) releases++;
    expect(releases).toBe(0);
    expect(step(state, 0.1).released).toBe(true);
  });
});
