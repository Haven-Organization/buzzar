import { MeshoptEncoder } from "meshoptimizer";
import { describe, expect, it } from "vitest";

import { decompressGLTF, isMeshoptFallbackBuffer } from "./decompress";
import { GLTFRoot } from "./GLTF";

describe("decompressGLTF", () => {
  it("decodes meshopt-compressed buffer views into a plain buffer", async () => {
    await MeshoptEncoder.ready;
    // 4 vertices of 3 floats (12-byte stride).
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    const encoded = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(vertices.buffer), 4, 12, "ATTRIBUTES");
    const source = new SharedArrayBuffer(encoded.byteLength);
    new Uint8Array(source).set(encoded);

    const root = {
      asset: { version: "2.0" },
      buffers: [
        { byteLength: encoded.byteLength },
        { byteLength: 48, extensions: { EXT_meshopt_compression: { fallback: true } } },
      ],
      bufferViews: [
        {
          buffer: 1,
          byteOffset: 0,
          byteLength: 48,
          byteStride: 12,
          extensions: {
            EXT_meshopt_compression: {
              buffer: 0,
              byteLength: encoded.byteLength,
              byteStride: 12,
              count: 4,
              mode: "ATTRIBUTES",
            },
          },
        },
      ],
      extensionsUsed: ["EXT_meshopt_compression"],
      extensionsRequired: ["EXT_meshopt_compression"],
    } as unknown as GLTFRoot;
    const buffers = new Map<number, SharedArrayBuffer>([
      [0, source],
      [1, new SharedArrayBuffer(0)],
    ]);

    expect(isMeshoptFallbackBuffer(root.buffers![1] as never)).toBe(true);
    await decompressGLTF(root, buffers);

    const view = root.bufferViews![0];
    expect(view.extensions?.EXT_meshopt_compression).toBeUndefined();
    const decoded = new Float32Array(buffers.get(view.buffer)!, view.byteOffset ?? 0, 12);
    expect([...decoded]).toEqual([...vertices]);
  });

  it("leaves files without compression alone", async () => {
    const root = { asset: { version: "2.0" }, buffers: [{ byteLength: 4 }] } as unknown as GLTFRoot;
    const buffers = new Map([[0, new SharedArrayBuffer(4)]]);
    await decompressGLTF(root, buffers);
    expect(root.buffers).toHaveLength(1);
  });
});
