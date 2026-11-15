// Adds a downward-facing roof plane over a rectangle, using one of the scene's own materials, so gaps in a
// model's ceiling show "ceiling" instead of sky.
// Usage: node add-roof.mjs <in.glb> <out.glb> <materialName> <minX> <maxX> <minZ> <maxZ> <y>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [inPath, outPath, materialName, ...nums] = process.argv.slice(2);
const [x0, x1, z0, z1, y] = nums.map(Number);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const buffer = root.listBuffers()[0];
const material = root.listMaterials().find((m) => m.getName() === materialName);
if (!material) throw new Error(`material ${materialName} not found: ${root.listMaterials().map((m) => m.getName())}`);
const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
// Facing down (-Y): seen from below, x0z0 → x1z0 → x1z1 is counter-clockwise.
const prim = doc
  .createPrimitive()
  .setMaterial(material)
  .setAttribute("POSITION", acc("VEC3", new Float32Array([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1])))
  .setAttribute("NORMAL", acc("VEC3", new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0])))
  .setAttribute("TEXCOORD_0", acc("VEC2", new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])))
  .setIndices(acc("SCALAR", new Uint16Array([0, 1, 2, 0, 2, 3])));
scene.addChild(doc.createNode("Roof").setMesh(doc.createMesh("Roof").addPrimitive(prim)));
await io.write(outPath, doc);
console.log(`roof at y=${y} over x ${x0}…${x1}, z ${z0}…${z1} with "${materialName}"`);
