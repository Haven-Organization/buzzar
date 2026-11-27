import { describe, expect, it } from "vitest";

import { parseItemCollection } from "./itemsMatrix";

describe("My Items", () => {
  it("reads a collection saved before Things became Items", () => {
    const old = { things: [{ url: "mxc://example.org/abc", added_ts: 1, name: "Water Gun" }] };
    expect(parseItemCollection(old).items).toEqual([{ url: "mxc://example.org/abc", added_ts: 1, name: "Water Gun" }]);
  });
});
