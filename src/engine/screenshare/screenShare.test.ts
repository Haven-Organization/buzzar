import { describe, expect, it } from "vitest";

import {
  fitScreen,
  floatingPlacement,
  poseMatrix,
  parseScreenAnnouncement,
  parseScreenPlacement,
  parseScreenShareRule,
  yawOfMatrix,
} from "./screenShare.common";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("screen placement", () => {
  it("puts a floating screen's handle 2 m ahead, below the eyes, the picture facing you", () => {
    // Looking down -Z (yaw 0).
    const p = floatingPlacement([1, 1.6, 5], 0, "medium");
    expect(p).toEqual({ kind: "floating", position: [1, 1.15, 3], rotation: [0, 0, 0, 1], size: "medium" });
    if (p.kind !== "floating") throw new Error();
    const m = poseMatrix(p.position, p.rotation);
    // The picture's front (+Z) points at the viewer, who is at +Z from it.
    expect([m[8], m[9], m[10]]).toEqual([0, 0, 1]);
    expect([m[12], m[13], m[14]]).toEqual([1, 1.15, 3]);
  });

  it("works when turned", () => {
    // Looking down -X: yaw +90°.
    const p = floatingPlacement([0, 1.6, 0], Math.PI / 2, "small");
    if (p.kind !== "floating") throw new Error();
    expect(p.position[0]).toBeCloseTo(-2);
    expect(p.position[2]).toBeCloseTo(0);
    const m = poseMatrix(p.position, p.rotation);
    // Front faces +X, towards the viewer.
    expect(m[8]).toBeCloseTo(1);
    expect(m[10]).toBeCloseTo(0);
  });

  it("reads the yaw back from a camera matrix", () => {
    for (const yaw of [0, 1, -2, 3]) {
      const m = poseMatrix([0, 0, 0], [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
      expect(yawOfMatrix(m)).toBeCloseTo(yaw);
    }
  });

  it("fits a picture in its space, keeping its shape", () => {
    expect(fitScreen(2, 2, 16 / 9)).toEqual([2, 2 / (16 / 9)]);
    expect(fitScreen(4, 1, 2)).toEqual([2, 1]);
    expect(fitScreen(2, 1, 0)).toEqual([2, 1]);
  });
});

describe("untrusted screen messages", () => {
  it("accepts good placements", () => {
    expect(parseScreenPlacement(JSON.stringify({ kind: "world", screen: "Cinema" }))).toEqual({
      kind: "world",
      screen: "Cinema",
    });
    expect(
      parseScreenPlacement(
        JSON.stringify({ kind: "floating", position: [1, 2, 3], rotation: [0, 0, 0, 2], size: "large" })
      )
    ).toEqual({ kind: "floating", position: [1, 2, 3], rotation: [0, 0, 0, 1], size: "large" });
  });

  it("rejects bad ones", () => {
    expect(parseScreenPlacement("not json")).toBeUndefined();
    expect(parseScreenPlacement(JSON.stringify({ kind: "world", screen: "" }))).toBeUndefined();
    const r = [0, 0, 0, 1];
    expect(parseScreenPlacement(JSON.stringify({ kind: "floating", position: [1, 2], rotation: r }))).toBeUndefined();
    expect(
      parseScreenPlacement(JSON.stringify({ kind: "floating", position: [1e9, 0, 0], rotation: r }))
    ).toBeUndefined();
    expect(
      parseScreenPlacement(JSON.stringify({ kind: "floating", position: [0, 0, 0], rotation: [0, 0, 0, 0] }))
    ).toBeUndefined();
    expect(parseScreenPlacement(JSON.stringify({ kind: "other" }))).toBeUndefined();
  });

  it("an odd size becomes medium", () => {
    const p = parseScreenPlacement(
      JSON.stringify({ kind: "floating", position: [0, 0, 0], rotation: [0, 0, 0, 1], size: "huge" })
    );
    expect(p).toMatchObject({ size: "medium" });
  });

  it("reads announcements", () => {
    expect(parseScreenAnnouncement(encode({ placement: null }))).toEqual({ placement: null });
    expect(parseScreenAnnouncement(encode({ placement: { kind: "world", screen: "A" } }))).toEqual({
      placement: { kind: "world", screen: "A" },
    });
    expect(parseScreenAnnouncement(encode({ placement: { kind: "nope" } }))).toBeUndefined();
    expect(parseScreenAnnouncement(new Uint8Array(5000))).toBeUndefined();
  });

  it("reads the world's rule", () => {
    expect(parseScreenShareRule(undefined)).toBe("everyone");
    expect(parseScreenShareRule({ screen_share: "moderators" })).toBe("moderators");
    expect(parseScreenShareRule({ screen_share: "nobody" })).toBe("nobody");
    expect(parseScreenShareRule({ screen_share: "whatever" })).toBe("everyone");
  });
});
