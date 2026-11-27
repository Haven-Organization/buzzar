import { describe, expect, it } from "vitest";

import { itemExtension, upgradeItemExtension } from "./itemExtension";

describe("Item files", () => {
  it("read HAVEN_item, or the older HAVEN_thing", () => {
    expect(itemExtension({ extensions: { HAVEN_item: { a: 1 } } })).toEqual({ a: 1 });
    expect(itemExtension({ extensions: { HAVEN_thing: { a: 2 } } })).toEqual({ a: 2 });
    expect(itemExtension({ extensions: { HAVEN_item: { a: 1 }, HAVEN_thing: { a: 2 } } })).toEqual({ a: 1 });
    expect(itemExtension(undefined)).toBeUndefined();
  });

  it("move HAVEN_thing to HAVEN_item when written", () => {
    const gltf = { extensions: { HAVEN_thing: { a: 2 } } as Record<string, unknown>, extensionsUsed: ["HAVEN_thing"] };
    upgradeItemExtension(gltf);
    expect(gltf.extensions).toEqual({ HAVEN_item: { a: 2 } });
    expect(gltf.extensionsUsed).toEqual(["HAVEN_item"]);
  });
});
