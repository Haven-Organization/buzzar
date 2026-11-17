import { beforeEach, describe, expect, it } from "vitest";

import {
  BLOCKED_WORLD_SCRIPTS_KEY,
  blockedWorldScripts,
  RUN_SCRIPTS_KEY,
  scriptPolicy,
  setWorldScriptBlocked,
} from "./scriptSettings";

beforeEach(() => {
  localStorage.clear();
});

describe("per-world script blocking", () => {
  it("blocks only the chosen world, and can be undone", () => {
    setWorldScriptBlocked("!a:hs", true);
    expect(scriptPolicy("mxc://hs/script", "!a:hs")).toEqual({ run: false, reason: "blocked" });
    expect(scriptPolicy("mxc://hs/script", "!b:hs")).toEqual({ run: true });
    setWorldScriptBlocked("!a:hs", false);
    expect(scriptPolicy("mxc://hs/script", "!a:hs")).toEqual({ run: true });
    expect(blockedWorldScripts()).toEqual([]);
  });

  it("scripts turned off everywhere still say so", () => {
    setWorldScriptBlocked("!a:hs", true);
    localStorage.setItem(RUN_SCRIPTS_KEY, "false");
    expect(scriptPolicy("mxc://hs/script", "!a:hs")).toEqual({ run: false, reason: "disabled" });
  });

  it("ignores garbage in storage", () => {
    localStorage.setItem(BLOCKED_WORLD_SCRIPTS_KEY, '{"nope": 1}');
    expect(blockedWorldScripts()).toEqual([]);
    localStorage.setItem(BLOCKED_WORLD_SCRIPTS_KEY, '["!a:hs", 3]');
    expect(blockedWorldScripts()).toEqual(["!a:hs"]);
  });
});
