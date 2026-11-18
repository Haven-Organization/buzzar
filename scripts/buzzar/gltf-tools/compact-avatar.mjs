// Shrinks an avatar without changing a single vertex, weight or pixel (lossless, unlike compress-world.mjs):
// - vertices no triangle uses are removed from each primitive (game rips often give every primitive the whole
//   model's vertex buffer);
// - identical accessors and textures are stored once;
// - anything left unreferenced is dropped (leaf nodes are kept: bone ends steer spring bones).
// Run it after prepare-avatar.py. Usage: node compact-avatar.mjs <in.glb> <out.glb>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { compactPrimitive, dedup, prune } from "@gltf-transform/functions";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node compact-avatar.mjs <in.glb> <out.glb>");
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
let before = 0;
let after = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    before += prim.getAttribute("POSITION").getCount();
    compactPrimitive(prim);
    after += prim.getAttribute("POSITION").getCount();
  }
}
await doc.transform(dedup(), prune({ keepLeaves: true, keepAttributes: true, keepIndices: true }));
await io.write(output, doc);
console.log(`vertices ${before} -> ${after}; wrote ${output}`);
