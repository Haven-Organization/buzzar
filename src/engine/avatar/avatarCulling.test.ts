import { describe, expect, it } from "vitest";

import { decideCulled, DEFAULT_AVATAR_CULLING, HIDE_BEYOND_MARGIN, parseAvatarCulling } from "./avatarCulling.common";

const settings = (beyond?: number, nearest?: number) => ({
  ...DEFAULT_AVATAR_CULLING,
  hideBeyond: { on: beyond !== undefined, meters: beyond ?? 25 },
  showNearest: { on: nearest !== undefined, count: nearest ?? 15 },
});
const at = (...distances: number[]) => distances.map((distance, i) => ({ peerId: `@p${i}:x`, distance }));

describe("avatar culling", () => {
  it("is off by default", () => {
    expect(parseAvatarCulling(undefined)).toEqual(DEFAULT_AVATAR_CULLING);
    expect(decideCulled(at(5, 500), DEFAULT_AVATAR_CULLING, new Set(), new Set()).size).toBe(0);
  });

  it("reads untrusted settings", () => {
    const s = parseAvatarCulling({ hideBeyond: { on: true, meters: 9999 }, showNearest: { on: true, count: -3 } });
    expect(s.hideBeyond).toEqual({ on: true, meters: 200 });
    expect(s.showNearest).toEqual({ on: true, count: 1 });
    expect(parseAvatarCulling({ alwaysShowFriends: false }).alwaysShowFriends).toBe(false);
  });

  it("hides avatars beyond the distance, with a margin before hiding", () => {
    const culled = decideCulled(at(10, 26, 40), settings(25), new Set(), new Set());
    expect([...culled]).toEqual(["@p2:x"]);
    // Already hidden: shown again only within the distance itself.
    expect([...decideCulled(at(10, 26, 40), settings(25), new Set(), new Set(["@p1:x"]))]).toEqual(["@p1:x", "@p2:x"]);
    expect(decideCulled(at(25 + HIDE_BEYOND_MARGIN - 0.1), settings(25), new Set(), new Set()).size).toBe(0);
  });

  it("shows only the nearest ones", () => {
    expect([...decideCulled(at(30, 10, 20, 5), settings(undefined, 2), new Set(), new Set())].sort()).toEqual([
      "@p0:x",
      "@p2:x",
    ]);
  });

  it("never hides exempt players, and they don't take a nearest slot", () => {
    const exempt = new Set(["@p0:x"]);
    const culled = decideCulled(at(1, 10, 20), settings(15, 1), exempt, new Set());
    expect([...culled]).toEqual(["@p2:x"]);
  });
});
