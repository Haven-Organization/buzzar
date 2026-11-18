import { describe, expect, it } from "vitest";

import { parseGamepadChoice, pickGamepads } from "./gamepadPreference";

const xbox0 = { id: "Xbox Wireless Controller", index: 0 };
const xbox1 = { id: "Xbox Wireless Controller", index: 1 };
const ds = { id: "DualSense Wireless Controller", index: 2 };
const pads = [xbox0, xbox1, ds];

describe("gamepad choice", () => {
  it("uses every pad by default and none when turned off", () => {
    expect(pickGamepads(pads, { kind: "any" })).toEqual(pads);
    expect(pickGamepads(pads, { kind: "none" })).toEqual([]);
  });

  it("uses only the picked pad, telling identical pads apart by slot", () => {
    expect(pickGamepads(pads, { kind: "pad", id: xbox0.id, index: 1 })).toEqual([xbox1]);
    expect(pickGamepads(pads, { kind: "pad", id: ds.id, index: 2 })).toEqual([ds]);
  });

  it("finds the picked pad in another slot after reconnecting, and uses nothing while it's away", () => {
    expect(pickGamepads([ds], { kind: "pad", id: ds.id, index: 0 })).toEqual([ds]);
    expect(pickGamepads([xbox0], { kind: "pad", id: ds.id, index: 2 })).toEqual([]);
  });

  it("reads stored choices defensively", () => {
    expect(parseGamepadChoice(null)).toEqual({ kind: "any" });
    expect(parseGamepadChoice({ kind: "pad", id: 5 })).toEqual({ kind: "any" });
    expect(parseGamepadChoice({ kind: "none" })).toEqual({ kind: "none" });
    expect(parseGamepadChoice({ kind: "pad", id: "x", index: 3 })).toEqual({ kind: "pad", id: "x", index: 3 });
  });
});
