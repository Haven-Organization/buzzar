// Encloses an area with walls along a closed outline, using one of the scene's own materials (UVs tiled every
// <tile> metres). The outline is listed so its inside is on the left of each edge when viewed from above
// (+Y), i.e. the inward normal of edge (dx, dz) is (-dz, dx).
// Usage: node add-walls.mjs <in.glb> <out.glb> <materialName> <bottomY> <topY> <tile> "x,z x,z x,z ..."
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [inPath, outPath, materialName, y0Arg, y1Arg, tileArg, outlineArg] = process.argv.slice(2);
const [y0, y1, tile] = [Number(y0Arg), Number(y1Arg), Number(tileArg)];
const outline = outlineArg
  .trim()
  .split(/\s+/)
  .map((p) => p.split(",").map(Number));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const buffer = root.listBuffers()[0];
const material = root.listMaterials().find((m) => m.getName() === materialName);
if (!material) throw new Error(`material ${materialName} not found: ${root.listMaterials().map((m) => m.getName())}`);
const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);

const pos = [],
  nrm = [],
  uv = [],
  idx = [];
outline.forEach(([ax, az], i) => {
  const [bx, bz] = outline[(i + 1) % outline.length];
  const len = Math.hypot(bx - ax, bz - az);
  const nx = -(bz - az) / len,
    nz = (bx - ax) / len; // inward normal
  const base = pos.length / 3;
  pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
  for (let k = 0; k < 4; k++) nrm.push(nx, 0, nz);
  const h = y1 - y0;
  uv.push(0, h / tile, len / tile, h / tile, len / tile, 0, 0, 0);
  // Front face towards the inside: (b - a) × (top - a) points along the inward normal for this outline
  // orientation, so a → b → top is counter-clockwise seen from inside (verified with raycast.mjs).
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
});
const prim = doc
  .createPrimitive()
  .setMaterial(material)
  .setAttribute("POSITION", acc("VEC3", new Float32Array(pos)))
  .setAttribute("NORMAL", acc("VEC3", new Float32Array(nrm)))
  .setAttribute("TEXCOORD_0", acc("VEC2", new Float32Array(uv)))
  .setIndices(acc("SCALAR", new Uint16Array(idx)));
scene.addChild(doc.createNode("Enclosure walls").setMesh(doc.createMesh("Enclosure walls").addPrimitive(prim)));
await io.write(outPath, doc);
console.log(`${outline.length} walls along the outline with "${materialName}"`);
