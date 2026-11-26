import { describe, expect, it } from "vitest";

import { readHold } from "./holdSpec";

describe("HAVEN_thing hold", () => {
  it("is absent without a grip", () => {
    expect(readHold(undefined)).toBeUndefined();
    expect(readHold({ extensions: { HAVEN_thing: { hold: { pose: "aim" } } } })).toBeUndefined();
  });

  it("reads grips and aims along a sprayer's nozzle by default (untrusted)", () => {
    const hold = readHold({
      extensions: {
        HAVEN_thing: {
          hold: {
            pose: "wave",
            hand: "left",
            grip: { position: [0, 0, 0], rotation: [0, 0, 0, 2] },
            offhand: { position: [0, 0.04, -0.2] },
            curl: 500,
          },
        },
        HAVEN_sprayer: { nozzle: { position: [0, 0.1, -0.4], direction: [0, 0, -3] } },
      },
    })!;
    expect(hold.pose).toBe("aim");
    expect(hold.hand).toBe("left");
    expect(hold.grip.rotation).toEqual([0, 0, 0, 1]);
    expect(hold.offhand).toEqual({ position: [0, 0.04, -0.2], rotation: [0, 0, 0, 1] });
    expect(hold.curl).toBe(70);
    expect(hold.aim).toEqual({ position: [0, 0.1, -0.4], direction: [0, 0, -1] });
  });
});
