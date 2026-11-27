import { describe, expect, it } from "vitest";

import {
  decodeItemVariables,
  encodeItemVariables,
  sanitizeItemVariables,
  itemVariableNames,
} from "./itemVariables.common";
import { parseItemClones } from "../../ui/utils/itemClones";

describe("Item variables", () => {
  it("keeps only the Item's own variables, clamped, and drops stock values", () => {
    expect(
      sanitizeItemVariables("small-crate", { size: 100, tint: [2, 0.5, -1], bounciness: 0, weight: 0, glow: 5, x: 1 })
    ).toEqual({ size: 4, tint: [1, 0.5, 0], weight: 0.1 });
    expect(sanitizeItemVariables("emissive-ball", { glow: 3, bounciness: 1 })).toEqual({ glow: 3 });
    expect(sanitizeItemVariables("black-mirror-ball", { tint: [0.5, 0.5, 0.5] })).toEqual({});
    expect(sanitizeItemVariables("not-a-item", { size: 2 })).toEqual({});
    expect(sanitizeItemVariables("small-crate", { size: NaN, tint: [1, 1, 1] })).toEqual({});
    expect(itemVariableNames("trampoline")).toEqual(["tint", "weight", "springiness"]);
    expect(sanitizeItemVariables("trampoline", { springiness: 9 })).toEqual({ springiness: 3 });
    expect(sanitizeItemVariables("small-crate", { springiness: 2 })).toEqual({});
  });

  it("round-trips through the wire format", () => {
    const v = { size: 0.5, tint: [0.25, 0.5, 1] as [number, number, number], weight: 20, glow: 2, springiness: 1.5 };
    expect(decodeItemVariables(encodeItemVariables(v))).toEqual(v);
    expect(decodeItemVariables(encodeItemVariables({}))).toEqual({});
  });

  it("rejects bad wire data without throwing", () => {
    expect(decodeItemVariables(undefined)).toBeUndefined();
    expect(decodeItemVariables(new Uint8Array([9, 1]).buffer)).toBeUndefined();
    // Says a size follows but the bytes stop: NaN, which sanitizing then drops.
    const truncated = decodeItemVariables(new Uint8Array([1, 1, 0]).buffer);
    expect(sanitizeItemVariables("small-crate", truncated)).toEqual({});
  });

  it("parses cloned Items from account data", () => {
    const clones = parseItemClones({
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
      { id: "clone:c", base: "mirror-ball", name: "Cloned Item", variables: { size: 4 } },
    ]);
    expect(parseItemClones(null)).toEqual([]);
  });
});
