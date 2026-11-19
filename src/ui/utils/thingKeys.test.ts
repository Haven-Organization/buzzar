import { describe, expect, it } from "vitest";

import { DEFAULT_THING_KEYS } from "../../plugins/thirdroom/thirdroom.common";
import { mapThing, parseThingKeys, unmapThing } from "./thingKeys";

const known = ["a", "b", "c", "trampoline"];
const empty = () => Array(10).fill(null);

describe("Thing keys", () => {
  it("defaults to the stock layout, trampoline on 7", () => {
    expect(parseThingKeys(undefined, known)).toEqual(DEFAULT_THING_KEYS);
    expect(DEFAULT_THING_KEYS[6]).toBe("trampoline");
  });

  it("drops unknown Things and duplicates, and always has ten slots", () => {
    const keys = parseThingKeys({ keys: ["a", "zzz", "a", 3, "b"] }, known);
    expect(keys).toEqual(["a", null, null, null, "b", null, null, null, null, null]);
  });

  it("maps onto a free key, swaps between keys, and pushes a Thing off when mapping from the list", () => {
    let keys = mapThing(empty(), "a", 0);
    keys = mapThing(keys, "b", 9);
    expect(keys[0]).toBe("a");
    expect(keys[9]).toBe("b");
    // b moves onto a's key: a takes b's old key.
    keys = mapThing(keys, "b", 0);
    expect(keys[0]).toBe("b");
    expect(keys[9]).toBe("a");
    // c (not on a key) onto b's key: b drops off.
    keys = mapThing(keys, "c", 0);
    expect(keys[0]).toBe("c");
    expect(keys.includes("b")).toBe(false);
    expect(unmapThing(keys, "c")[0]).toBe(null);
  });
});
