import { AUTO_KEY, LEGACY_AUTO_KEY, parseSpaceAccountData, planSpaceChildren, viaServers } from "./buzzarSpace";

describe("Buzzar space", () => {
  it("parses account data defensively", () => {
    expect(parseSpaceAccountData({ room_id: "!a", avatar_url: "mxc://s/x" })).toEqual({
      room_id: "!a",
      avatar_url: "mxc://s/x",
    });
    expect(parseSpaceAccountData({ disabled: true })).toEqual({ disabled: true });
    expect(parseSpaceAccountData({ room_id: "nope", avatar_url: "http://x", disabled: "yes" })).toEqual({});
    expect(parseSpaceAccountData(null)).toBeUndefined();
  });

  it("joins v12 rooms through the user's server and older rooms through theirs too", () => {
    expect(viaServers("!abc", "@alice:example.org")).toEqual(["example.org"]);
    expect(viaServers("!abc:matrix.org", "@alice:example.org")).toEqual(["example.org", "matrix.org"]);
  });

  it("adds missing worlds and removes only auto-added worlds the user left", () => {
    const children = new Map<string, Record<string, unknown>>([
      ["!kept", { via: ["s"], "software.haven.auto": true }],
      ["!left", { via: ["s"], "software.haven.auto": true }],
      ["!manual", { via: ["s"] }],
      ["!removed-before", {}],
    ]);
    const plan = planSpaceChildren(
      children,
      ["!kept", "!new", "!removed-before"],
      new Set(["!kept", "!new", "!removed-before"])
    );
    expect(plan.add.sort()).toEqual(["!new", "!removed-before"]);
    expect(plan.remove).toEqual(["!left"]);
  });

  it("keeps an auto-added room the user is still joined to even if it isn't listed as a world", () => {
    const children = new Map([["!x", { via: ["s"], "software.haven.auto": true }]]);
    expect(planSpaceChildren(children, [], new Set(["!x"])).remove).toEqual([]);
  });

  it("recognises the old tag name and retags those children with the new one", () => {
    const children = new Map<string, Record<string, unknown>>([
      ["!old-kept", { via: ["s"], [LEGACY_AUTO_KEY]: true }],
      ["!old-left", { via: ["s"], [LEGACY_AUTO_KEY]: true }],
      ["!new-tag", { via: ["s"], [AUTO_KEY]: true }],
    ]);
    const plan = planSpaceChildren(children, ["!old-kept", "!new-tag"], new Set(["!old-kept", "!new-tag"]));
    expect(plan.remove).toEqual(["!old-left"]);
    expect(plan.retag).toEqual(["!old-kept"]);
    expect(plan.add).toEqual([]);
  });
});
