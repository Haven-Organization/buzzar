import { describe, expect, test } from "vitest";

import { parseMatrixUri } from "./matrixUtils";

describe("parseMatrixUri", () => {
  test("matrix: room alias", () => {
    expect(parseMatrixUri("matrix:r/world:example.org")).toMatchObject({ mxid1: "#world:example.org", via: [] });
  });

  test("matrix: room id with via servers", () => {
    expect(parseMatrixUri("matrix:roomid/abc123?via=example.org&via=other.net")).toMatchObject({
      mxid1: "!abc123",
      via: ["example.org", "other.net"],
    });
  });

  test("matrix: percent-encoded segment", () => {
    expect(parseMatrixUri("matrix:r/world%3Aexample.org")).toMatchObject({ mxid1: "#world:example.org" });
  });

  test("matrix.to alias link", () => {
    expect(parseMatrixUri("https://matrix.to/#/#world:example.org")).toMatchObject({
      protocol: "matrix:",
      mxid1: "#world:example.org",
      via: [],
    });
  });

  test("matrix.to room id link with via and event", () => {
    expect(parseMatrixUri("https://matrix.to/#/!abc:example.org/$event1?via=example.org")).toMatchObject({
      mxid1: "!abc:example.org",
      mxid2: "$event1",
      via: ["example.org"],
    });
  });

  test("matrix.to encoded alias", () => {
    expect(parseMatrixUri("https://matrix.to/#/%23world%3Aexample.org")).toMatchObject({ mxid1: "#world:example.org" });
  });

  test("invalid matrix.to link throws", () => {
    expect(() => parseMatrixUri("https://matrix.to/#/")).toThrow();
  });

  test("other web links stay URLs", () => {
    const parsed = parseMatrixUri("https://example.org/page");
    expect(parsed).toBeInstanceOf(URL);
  });
});
