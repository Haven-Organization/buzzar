import { describe, expect, it } from "vitest";

import { decideCallMethod, recommendedCallMethod } from "./callMethod";

describe("recommendedCallMethod", () => {
  it("reads the world's choice and falls back to mesh", () => {
    expect(recommendedCallMethod({ recommended_method: "livekit" })).toBe("livekit");
    expect(recommendedCallMethod({ recommended_method: "mesh" })).toBe("mesh");
    expect(recommendedCallMethod({ recommended_method: "carrier pigeon" })).toBe("mesh");
    expect(recommendedCallMethod(undefined)).toBe("mesh");
  });
});

describe("decideCallMethod", () => {
  it("starts the preferred call when nobody is in any", () => {
    expect(decideCallMethod("livekit", { mesh: [], livekit: [] })).toEqual({ kind: "join", method: "livekit" });
  });

  it("joins the preferred call when it's the only one open", () => {
    expect(decideCallMethod("mesh", { mesh: ["@a:x"], livekit: [] })).toEqual({ kind: "join", method: "mesh" });
  });

  it("asks when only the other kind of call is open, offering it and the preferred one", () => {
    expect(decideCallMethod("livekit", { mesh: ["@a:x", "@b:x"], livekit: [] })).toEqual({
      kind: "ask",
      preferred: "livekit",
      options: [
        { method: "mesh", players: ["@a:x", "@b:x"] },
        { method: "livekit", players: [] },
      ],
    });
  });

  it("asks when both kinds are open, the busier call first", () => {
    const decision = decideCallMethod("mesh", { mesh: ["@a:x"], livekit: ["@b:x", "@c:x"] });
    expect(decision).toEqual({
      kind: "ask",
      preferred: "mesh",
      options: [
        { method: "livekit", players: ["@b:x", "@c:x"] },
        { method: "mesh", players: ["@a:x"] },
      ],
    });
  });
});
