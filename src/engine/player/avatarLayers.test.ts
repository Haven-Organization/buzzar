import { describe, expect, test } from "vitest";

import { isInLayer, Layer } from "../common/Layers";
import { computeAvatarNodeLayers } from "./avatarLayers";

describe("avatar layers", () => {
  test("remote avatars are on Default + Avatar", () => {
    const layers = computeAvatarNodeLayers(1 << Layer.Default, false);
    expect(isInLayer(layers, Layer.Default)).toBe(true);
    expect(isInLayer(layers, Layer.Avatar)).toBe(true);
  });

  test("own first-person avatar is hidden from the main camera but kept for mirrors", () => {
    const layers = computeAvatarNodeLayers(1 << Layer.Default, true);
    expect(isInLayer(layers, Layer.Default)).toBe(false);
    expect(isInLayer(layers, Layer.Avatar)).toBe(true);
  });

  test("preserves unrelated layers", () => {
    const layers = computeAvatarNodeLayers((1 << Layer.Default) | (1 << Layer.EditorSelection), true);
    expect(isInLayer(layers, Layer.EditorSelection)).toBe(true);
  });
});
