import { Vector2 } from "three";
import { describe, expect, it } from "vitest";

import { perTextureDecodeParams } from "./UpdateReflectionProbesSystem";

describe("reflection probe decoding (Third Room #396)", () => {
  it("gives each texture its own decode, as the PMREM generator copies it once per texture", () => {
    const params = perTextureDecodeParams([false, true, false]);
    const uniform = new Vector2();
    const seen = [0, 1, 2].map(() => uniform.copy(params).toArray());
    expect(seen).toEqual([
      [1, 1],
      [34.49, 2.2],
      [1, 1],
    ]);
  });
});
