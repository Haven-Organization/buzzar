import { reconcilePeerDevices } from "./peerDevices";

const m = (userId: string, deviceId: string, usable = true) => ({ userId, deviceId, usable });

describe("reconcilePeerDevices", () => {
  it("adds one peer per connected user, skipping our own other devices", () => {
    const current = new Map<string, string>();
    const changes = reconcilePeerDevices(current, [m("@a", "A1"), m("@me", "OTHER"), m("@b", "B1", false)], "@me");
    expect(changes.remove).toEqual([]);
    expect(changes.add.map((x) => x.deviceId)).toEqual(["A1"]);
    expect([...current]).toEqual([["@a", "A1"]]);
  });

  it("keeps the live peer when a stale device of the same user leaves", () => {
    const current = new Map([["@a", "A2"]]);
    // A1 (stale) is gone; A2 is still connected.
    const changes = reconcilePeerDevices(current, [m("@a", "A2")], "@me");
    expect(changes).toEqual({ remove: [], add: [] });
  });

  it("does not switch devices while the current one stays connected", () => {
    const current = new Map([["@a", "A1"]]);
    const changes = reconcilePeerDevices(current, [m("@a", "A1"), m("@a", "A2")], "@me");
    expect(changes).toEqual({ remove: [], add: [] });
  });

  it("moves the peer to another connected device when the current one drops", () => {
    const current = new Map([["@a", "A1"]]);
    const changes = reconcilePeerDevices(current, [m("@a", "A1", false), m("@a", "A2")], "@me");
    expect(changes.remove).toEqual(["@a"]);
    expect(changes.add.map((x) => x.deviceId)).toEqual(["A2"]);
    expect(current.get("@a")).toBe("A2");
  });

  it("removes the peer when the user has no connected device left", () => {
    const current = new Map([["@a", "A1"]]);
    const changes = reconcilePeerDevices(current, [], "@me");
    expect(changes).toEqual({ remove: ["@a"], add: [] });
    expect(current.size).toBe(0);
  });
});
