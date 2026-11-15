// Optimizes an imported scene for Buzzar (no compression extensions the engine can't decode):
// dedup + flatten + join (draw calls), weld, prune, resize textures to <= 1024 px, and JPEG for textures that
// no transparent material uses (alpha must survive) and that aren't normal maps.
// Usage: node optimize-world.mjs <in.glb> <out.glb>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, flatten, join, prune, textureCompress, weld } from "@gltf-transform/functions";
import sharp from "sharp";

const [input, output] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);

await doc.transform(dedup(), flatten(), join(), weld(), prune());

// Name textures by whether they can lose alpha.
const keepAlpha = new Set();
for (const material of doc.getRoot().listMaterials()) {
  if (material.getAlphaMode() !== "OPAQUE") {
    const t = material.getBaseColorTexture();
    if (t) keepAlpha.add(t);
  }
  const n = material.getNormalTexture();
  if (n) keepAlpha.add(n);
}
doc
  .getRoot()
  .listTextures()
  .forEach((t, i) => t.setName(`${keepAlpha.has(t) ? "png" : "jpg"}_${i}`));

await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: "jpeg", quality: 82, resize: [1024, 1024], pattern: /^jpg_/ }),
  textureCompress({ encoder: sharp, targetFormat: "png", resize: [1024, 1024], pattern: /^png_/ }),
  prune()
);

await io.write(output, doc);
const kinds = {};
for (const t of doc.getRoot().listTextures()) kinds[t.getMimeType()] = (kinds[t.getMimeType()] ?? 0) + 1;
console.log(
  "textures",
  kinds,
  "materials",
  doc.getRoot().listMaterials().length,
  "meshes",
  doc.getRoot().listMeshes().length
);
