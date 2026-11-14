import { describe, expect, test } from "vitest";

import { resolvePedestalUri } from "./pedestals.game";

const HS = "https://matrix-client.matrix.org";

describe("resolvePedestalUri", () => {
  test("mxc URIs resolve through the homeserver", () => {
    expect(resolvePedestalUri("mxc://matrix.org/abc", "https://x/world.glb", HS)).toBe(
      `${HS}/_matrix/media/r0/download/matrix.org/abc`
    );
    expect(resolvePedestalUri("mxc://matrix.org/abc", "https://x/world.glb")).toBeUndefined();
  });

  test("relative paths stay next to the world file", () => {
    expect(resolvePedestalUri("../../avatars/a.vrm", "http://localhost:3000/gltf/test/w.glb")).toBe(
      "http://localhost:3000/avatars/a.vrm"
    );
  });

  test("third-party and script URLs are refused", () => {
    for (const uri of [
      "https://evil.example/a.vrm",
      "//evil.example/a.vrm",
      "javascript:alert(1)",
      "data:model/gltf-binary;base64,AA",
    ]) {
      expect(resolvePedestalUri(uri, "http://localhost:3000/w.glb", HS)).toBeUndefined();
    }
  });
});
