import { describe, expect, it } from "vitest";

import { bakeFileMetadata, metadataDiffers, readFileMetadata } from "./glbMetadata";

function glb(json: object, bin = new Uint8Array([1, 2, 3, 4])) {
  let j = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (j.length % 4)) % 4;
  const jp = new Uint8Array(j.length + pad).fill(0x20);
  jp.set(j);
  j = jp;
  const out = new Uint8Array(20 + j.length + 8 + bin.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, j.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(j, 20);
  v.setUint32(20 + j.length, bin.length, true);
  v.setUint32(24 + j.length, 0x004e4942, true);
  out.set(bin, 28 + j.length);
  return new Blob([out]);
}

describe("file details on upload", () => {
  it("reads, compares and bakes description and version, keeping the binary data", async () => {
    const file = glb({ asset: { version: "2.0" }, extensions: { HAVEN_metadata: { name: "Box", version: "0.1.0" } } });
    const meta = await readFileMetadata(file);
    expect(meta).toEqual({ name: "Box", version: "0.1.0" });
    expect(metadataDiffers(meta, { version: "0.1.0" })).toBe(false);
    expect(metadataDiffers(meta, { version: "" })).toBe(false);
    expect(metadataDiffers(meta, { description: "Line 1\nLine 2" })).toBe(true);

    const baked = await bakeFileMetadata(file, { description: "Line 1\r\nLine 2", version: "0.2.0" });
    expect(await readFileMetadata(baked)).toEqual({ name: "Box", description: "Line 1\nLine 2", version: "0.2.0" });
    const bytes = new Uint8Array(
      await new Promise<ArrayBuffer>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.readAsArrayBuffer(baked);
      })
    );
    expect(Array.from(bytes.slice(-4))).toEqual([1, 2, 3, 4]);
  });
});
