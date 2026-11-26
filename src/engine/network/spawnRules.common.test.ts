import { describe, expect, it } from "vitest";

import {
  isCustomThingId,
  isSpawnAllowed,
  parseListedThings,
  parseSpawnRules,
  rememberThingBehaviours,
  serializeObjectRules,
} from "./spawnRules.common";

const LAMP = "mxc://example.org/lamp1";
const OTHER = "mxc://example.org/other";

describe("world Thing rules", () => {
  it("allows every Thing when there are no rules", () => {
    const rules = parseSpawnRules(undefined);
    expect(isSpawnAllowed(rules, "trampoline")).toBe(true);
    expect(isSpawnAllowed(rules, LAMP)).toBe(true);
  });

  it("reads old events' `allowed` as a block list of the stock Things left out", () => {
    const rules = parseSpawnRules({ objects: { allowed: ["small-crate", "small-ball"] } });
    expect(rules.default).toBe("allow");
    expect(isSpawnAllowed(rules, "small-crate")).toBe(true);
    expect(isSpawnAllowed(rules, "trampoline")).toBe(false);
    expect(isSpawnAllowed(rules, LAMP)).toBe(true);
  });

  it("allow list: only the listed files, not stock Things or other files", () => {
    const rules = parseSpawnRules({ objects: { default: "block", things: [{ id: LAMP, allow: true }] } });
    expect(isSpawnAllowed(rules, LAMP)).toBe(true);
    expect(isSpawnAllowed(rules, OTHER)).toBe(false);
    expect(isSpawnAllowed(rules, "small-crate")).toBe(false);
  });

  it("never applies to things that aren't spawnable Things", () => {
    const rules = parseSpawnRules({ objects: { default: "block" } });
    expect(isSpawnAllowed(rules, "avatar")).toBe(true);
    expect(isSpawnAllowed(rules, "scene-grabbable-12")).toBe(true);
  });

  it("a blocked behaviour wins over the list", () => {
    const rules = parseSpawnRules({
      objects: { things: [{ id: "trampoline", allow: true }], blocked_behaviours: ["HAVEN_trampoline"] },
    });
    expect(isSpawnAllowed(rules, "trampoline")).toBe(false);
    expect(isSpawnAllowed(rules, "small-ball")).toBe(true);
  });

  it("drops bad entries", () => {
    const list = parseListedThings({
      things: [
        { id: "https://evil.example/x.glb", allow: true },
        { id: LAMP, allow: "yes" },
        { id: LAMP, allow: true, name: " Lamp ", preview_url: "javascript:1" },
        { id: LAMP, allow: false },
      ],
    });
    expect(list).toEqual([{ id: LAMP, allow: true, name: "Lamp" }]);
  });

  it("writes `allowed` for older clients and keeps other fields", () => {
    const out = serializeObjectRules(
      { max_per_user: 3 },
      { default: "block", things: [{ id: "small-ball", allow: true }], blockedBehaviours: [] }
    );
    expect(out.allowed).toEqual(["small-ball"]);
    expect(out.max_per_user).toBe(3);
    expect(parseSpawnRules({ objects: out }).things).toEqual({ "small-ball": true });
  });
});

describe("custom Things' behaviours", () => {
  const mxc = "mxc://example.org/abcDEF123";
  it("are learnt from the file, and a world can block them", () => {
    expect(isCustomThingId(mxc)).toBe(true);
    expect(isCustomThingId("trampoline")).toBe(false);
    const rules = parseSpawnRules({ objects: { blocked_behaviours: ["HAVEN_trampoline"] } });
    // Not known until the file has loaded.
    expect(isSpawnAllowed(rules, mxc)).toBe(true);
    rememberThingBehaviours(mxc, ["KHR_materials_unlit", "HAVEN_trampoline"]);
    expect(isSpawnAllowed(rules, mxc)).toBe(false);
  });
});
