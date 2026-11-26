import { describe, expect, it } from "vitest";

import { fullTank, readSprayer, stepTank } from "./sprayer.common";

describe("HAVEN_sprayer", () => {
  it("is absent unless the file has it", () => {
    expect(readSprayer(undefined)).toBeUndefined();
    expect(readSprayer({ extensions: {} })).toBeUndefined();
  });

  it("reads the file's values, defaulting the rest (untrusted)", () => {
    const spec = readSprayer({
      extensions: {
        HAVEN_sprayer: {
          nozzle: { position: [0, 0.1, -0.4], direction: [0, 0, -2] },
          capacity: 4,
          pumpTime: 2,
          speed: 1000,
          sounds: { spray: 0, pump: 1, empty: -1 },
        },
      },
    })!;
    expect(spec.nozzle).toEqual([0, 0.1, -0.4]);
    expect(spec.direction).toEqual([0, 0, -1]);
    expect(spec.capacity).toBe(4);
    expect(spec.refill).toBe(4); // a full tank per pump
    expect(spec.speed).toBe(9); // out of range: the default
    expect(spec.sounds).toEqual({ start: undefined, spray: 0, pump: 1, empty: undefined });
    expect(spec.startLength).toBe(0);
  });
});

describe("a sprayer's tank", () => {
  const spec = readSprayer({ extensions: { HAVEN_sprayer: { capacity: 1, refill: 1, pumpTime: 0.5 } } })!;

  it("drains while the trigger is held, and stops when it's empty", () => {
    const tank = fullTank(spec);
    expect(stepTank(tank, spec, 0.6, true, false).spraying).toBe(true);
    const last = stepTank(tank, spec, 0.6, true, false);
    expect(last).toEqual({ spraying: true, pumped: false, ranDry: true });
    expect(stepTank(tank, spec, 0.1, true, false).spraying).toBe(false);
  });

  it("refills when a pump stroke finishes, and can't spray mid-stroke", () => {
    const tank = { water: 0, pumping: 0 };
    expect(stepTank(tank, spec, 0.1, false, true).pumped).toBe(true);
    expect(stepTank(tank, spec, 0.3, true, false).spraying).toBe(false);
    expect(tank.water).toBe(0);
    stepTank(tank, spec, 0.3, false, false);
    expect(tank.water).toBe(1);
    expect(stepTank(tank, spec, 0.1, true, false).spraying).toBe(true);
  });

  it("pumps when the trigger is pressed with the tank empty", () => {
    const tank = { water: 0, pumping: 0 };
    // Holding the trigger down after it ran dry doesn't pump; pressing it again does.
    expect(stepTank(tank, spec, 0.1, true, false, false).pumped).toBe(false);
    expect(stepTank(tank, spec, 0.1, true, false, true).pumped).toBe(true);
    // With water left, pressing it just sprays.
    const full = fullTank(spec);
    expect(stepTank(full, spec, 0.1, true, false, true)).toEqual({ spraying: true, pumped: false, ranDry: false });
  });
});
