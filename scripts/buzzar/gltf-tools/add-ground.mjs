// Adds a large textured ground quad under a scene (so walking out of a building doesn't drop you into the void).
// Usage: node add-ground.mjs <in.glb> <texture.jpg> <y> <halfSize> <tileMetres> <out.glb> [name]
import { readFileSync } from "node:fs";
import { getBounds, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [inPath, texPath, yArg, halfArg, tileArg, outPath, name = "Ground"] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);
const scene = doc.getRoot().listScenes()[0];
const buffer = doc.getRoot().listBuffers()[0];
const { min, max } = getBounds(scene);
const cx = (min[0] + max[0]) / 2,
  cz = (min[2] + max[2]) / 2;
const y = Number(yArg),
  h = Number(halfArg),
  tile = Number(tileArg);
const [x0, x1, z0, z1] = [cx - h, cx + h, cz - h, cz + h];

const texture = doc.createTexture(name).setImage(readFileSync(texPath)).setMimeType("image/jpeg");
const material = doc.createMaterial(name).setBaseColorTexture(texture).setRoughnessFactor(0.95).setMetallicFactor(0);
material.getBaseColorTextureInfo().setWrapS(10497).setWrapT(10497);
const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const prim = doc
  .createPrimitive()
  .setAttribute("POSITION", acc("VEC3", new Float32Array([x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0])))
  .setAttribute("NORMAL", acc("VEC3", new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])))
  .setAttribute(
    "TEXCOORD_0",
    acc(
      "VEC2",
      new Float32Array([x0 / tile, z0 / tile, x0 / tile, z1 / tile, x1 / tile, z1 / tile, x1 / tile, z0 / tile])
    )
  )
  .setIndices(acc("SCALAR", new Uint16Array([0, 1, 2, 0, 2, 3])))
  .setMaterial(material);
scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
await io.write(outPath, doc);
console.log(`ground ${name} at y=${y}, ${2 * h} m square around (${cx.toFixed(1)}, ${cz.toFixed(1)})`);
