import { afterEach, describe, expect, it } from "vitest";

import {
  decideCallMethod,
  IGNORE_MESH_CAP_KEY,
  MESH_CALL_CAP,
  meshCallHasRoom,
  recommendedCallMethod,
} from "./callMethod";

describe("recommendedCallMethod", () => {
  it("reads the world's choice and falls back to LiveKit", () => {
    expect(recommendedCallMethod({ recommended_method: "livekit" })).toBe("livekit");
    expect(recommendedCallMethod({ recommended_method: "mesh" })).toBe("mesh");
    expect(recommendedCallMethod({ recommended_method: "carrier pigeon" })).toBe("livekit");
    expect(recommendedCallMethod(undefined)).toBe("livekit");
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

describe("peer-to-peer call cap", () => {
  afterEach(() => localStorage.clear());

  it("has room below the cap and none at it", () => {
    expect(meshCallHasRoom(MESH_CALL_CAP - 1)).toBe(true);
    expect(meshCallHasRoom(MESH_CALL_CAP)).toBe(false);
  });

  it("lets developers join a full call only with Developer Mode and the setting on", () => {
    localStorage.setItem(IGNORE_MESH_CAP_KEY, "true");
    expect(meshCallHasRoom(MESH_CALL_CAP)).toBe(false);
    localStorage.setItem("buzzar.developerMode", "true");
    expect(meshCallHasRoom(MESH_CALL_CAP + 5)).toBe(true);
  });
});
