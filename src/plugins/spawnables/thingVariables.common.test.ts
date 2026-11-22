import { describe, expect, it } from "vitest";

import {
  decodeThingVariables,
  encodeThingVariables,
  sanitizeThingVariables,
  thingVariableNames,
} from "./thingVariables.common";
import { parseThingClones } from "../../ui/utils/thingClones";

describe("Thing variables", () => {
  it("keeps only the Thing's own variables, clamped, and drops stock values", () => {
    expect(
      sanitizeThingVariables("small-crate", { size: 100, tint: [2, 0.5, -1], bounciness: 0, weight: 0, glow: 5, x: 1 })
    ).toEqual({ size: 4, tint: [1, 0.5, 0], weight: 0.1 });
    expect(sanitizeThingVariables("emissive-ball", { glow: 3, bounciness: 1 })).toEqual({ glow: 3 });
    expect(sanitizeThingVariables("black-mirror-ball", { tint: [0.5, 0.5, 0.5] })).toEqual({});
    expect(sanitizeThingVariables("not-a-thing", { size: 2 })).toEqual({});
    expect(sanitizeThingVariables("small-crate", { size: NaN, tint: [1, 1, 1] })).toEqual({});
    expect(thingVariableNames("trampoline")).toEqual(["tint", "weight", "springiness"]);
    expect(sanitizeThingVariables("trampoline", { springiness: 9 })).toEqual({ springiness: 3 });
    expect(sanitizeThingVariables("small-crate", { springiness: 2 })).toEqual({});
  });

  it("round-trips through the wire format", () => {
    const v = { size: 0.5, tint: [0.25, 0.5, 1] as [number, number, number], weight: 20, glow: 2, springiness: 1.5 };
    expect(decodeThingVariables(encodeThingVariables(v))).toEqual(v);
    expect(decodeThingVariables(encodeThingVariables({}))).toEqual({});
  });

  it("rejects bad wire data without throwing", () => {
    expect(decodeThingVariables(undefined)).toBeUndefined();
    expect(decodeThingVariables(new Uint8Array([9, 1]).buffer)).toBeUndefined();
    // Says a size follows but the bytes stop: NaN, which sanitizing then drops.
    const truncated = decodeThingVariables(new Uint8Array([1, 1, 0]).buffer);
    expect(sanitizeThingVariables("small-crate", truncated)).toEqual({});
  });

  it("parses cloned Things from account data", () => {
    const clones = parseThingClones({
      clones: [
        { id: "clone:a", base: "small-crate", name: " Smaller Crate ", variables: { size: 0.5 } },
        { id: "clone:a", base: "small-crate", name: "duplicate" },
        { id: "nope", base: "small-crate", name: "bad id" },
        { id: "clone:b", base: "unknown", name: "bad base" },
        { id: "clone:c", base: "mirror-ball", variables: { size: 99 } },
      ],
    });
    expect(clones).toEqual([
      { id: "clone:a", base: "small-crate", name: "Smaller Crate", variables: { size: 0.5 } },
      { id: "clone:c", base: "mirror-ball", name: "Cloned Thing", variables: { size: 4 } },
    ]);
    expect(parseThingClones(null)).toEqual([]);
  });
});
