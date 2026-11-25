import { isWorldStateType, missingWorldState, parseTombstone, upgradeViaServers } from "./roomUpgrade";

describe("room upgrades", () => {
  it("parses tombstones and ignores ones pointing nowhere or at the room itself", () => {
    expect(parseTombstone({ content: { replacement_room: "!new", body: "moved" }, sender: "@a:x" }, "!old")).toEqual({
      replacementRoom: "!new",
      body: "moved",
      sender: "@a:x",
    });
    expect(parseTombstone({ content: { replacement_room: "!old" } }, "!old")).toBeUndefined();
    expect(parseTombstone({ content: {} }, "!old")).toBeUndefined();
    expect(parseTombstone(undefined)).toBeUndefined();
  });

  it("joins through the upgrader's server and the user's own", () => {
    expect(upgradeViaServers({ replacementRoom: "!v12id", sender: "@alice:example.org" }, "@p:matrix.org")).toEqual([
      "example.org",
      "matrix.org",
    ]);
  });

  it("copies only missing world state", () => {
    expect(isWorldStateType("org.matrix.msc3815.world")).toBe(true);
    expect(isWorldStateType("org.matrix.msc3401.call.member")).toBe(false);
    expect(isWorldStateType("m.room.name")).toBe(false);
    const oldState = [
      { type: "org.matrix.msc3815.world", state_key: "", content: { scene_url: "mxc://a/b" } },
      { type: "software.haven.rules", state_key: "", content: { x: 1 } },
      { type: "software.haven.empty", state_key: "", content: {} },
      { type: "m.room.name", state_key: "", content: { name: "n" } },
    ];
    const newState = [{ type: "software.haven.rules", state_key: "", content: { x: 2 } }];
    expect(missingWorldState(oldState, newState).map((e) => e.type)).toEqual(["org.matrix.msc3815.world"]);
  });
});
