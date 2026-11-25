import { describe, expect, it } from "vitest";

import { parseExploreConfig } from "./exploreConfig";

describe("Explore config", () => {
  it("defaults to just your own server when there's no config", () => {
    expect(parseExploreConfig(undefined)).toEqual({
      includeOwnServer: true,
      directoryServers: [],
      suggestedWorlds: [],
    });
  });

  it("reads servers and both forms of suggested world, skipping junk and duplicates", () => {
    const config = parseExploreConfig({
      includeOwnServer: false,
      directoryServers: ["https://Example.org/", "example.org", "not a server", 7],
      suggestedWorlds: [
        "#world:matrix.org",
        "#world:matrix.org",
        { roomId: "!abc:example.org", via: ["example.org", "matrix.org"] },
        { roomId: "!noVia:other.org" },
        "hello",
        { via: ["x.org"] },
      ],
    });
    expect(config.includeOwnServer).toBe(false);
    expect(config.directoryServers).toEqual(["example.org"]);
    expect(config.suggestedWorlds).toEqual([
      { target: "#world:matrix.org", via: [] },
      { target: "!abc:example.org", via: ["example.org", "matrix.org"] },
      { target: "!noVia:other.org", via: ["other.org"] },
    ]);
  });
});
