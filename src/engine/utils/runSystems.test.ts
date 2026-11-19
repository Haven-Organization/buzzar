import { describe, expect, it } from "vitest";

import { createSystemErrorLog, runSystems } from "./runSystems";

describe("runSystems", () => {
  it("keeps running the other systems when one throws, and doesn't flood the log", () => {
    const ran: string[] = [];
    const reports: string[] = [];
    function Broken() {
      throw new Error("Resource 16960 not found");
    }
    const systems = [() => ran.push("a"), Broken, () => ran.push("b")];
    const log = createSystemErrorLog();
    for (let tick = 0; tick < 1200; tick++) runSystems({}, systems, log, (message) => reports.push(message));
    expect(ran.length).toBe(2400);
    expect(reports.length).toBe(3);
    expect(reports[0]).toBe("Broken failed; the rest of the frame carried on.");
    expect(reports[2]).toContain("1200 times");
  });
});
