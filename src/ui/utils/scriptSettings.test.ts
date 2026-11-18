import { beforeEach, describe, expect, it } from "vitest";

import { RUN_SCRIPTS_KEY, scriptPolicy, setEnterWithoutScript, takeEnterWithoutScript } from "./scriptSettings";

beforeEach(() => {
  localStorage.clear();
  setEnterWithoutScript(undefined);
});

describe("Enter Without Script", () => {
  it("applies to one entry into that world only", () => {
    setEnterWithoutScript("!a:hs");
    expect(takeEnterWithoutScript("!a:hs")).toBe(true);
    // Used up: the next entry runs the script again.
    expect(takeEnterWithoutScript("!a:hs")).toBe(false);
  });

  it("is cleared by entering any other world", () => {
    setEnterWithoutScript("!a:hs");
    expect(takeEnterWithoutScript("!b:hs")).toBe(false);
    expect(takeEnterWithoutScript("!a:hs")).toBe(false);
  });

  it("skips the script, unless scripts are off everywhere (which says so)", () => {
    expect(scriptPolicy("mxc://hs/script", true)).toEqual({ run: false, reason: "skipped" });
    expect(scriptPolicy("mxc://hs/script")).toEqual({ run: true });
    localStorage.setItem(RUN_SCRIPTS_KEY, "false");
    expect(scriptPolicy("mxc://hs/script", true)).toEqual({ run: false, reason: "disabled" });
  });
});
