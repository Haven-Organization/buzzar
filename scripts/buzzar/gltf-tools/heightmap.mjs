// Top-down height map of a glTF scene: highest surface per cell, written as a PGM image + JSON grid.
// Usage: node heightmap.mjs <in.glb> <out-prefix> [cell=0.25] [cap height]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { writeFileSync } from "node:fs";

const [input, prefix, cellArg, capArg] = process.argv.slice(2);
const cap = capArg === undefined ? Infinity : Number(capArg); // ignore triangles entirely above this height
const cell = Number(cellArg ?? 0.25);
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(input);

const tris = [];
let minX = Infinity,
  minZ = Infinity,
  maxX = -Infinity,
  maxZ = -Infinity,
  minY = Infinity,
  maxY = -Infinity;
const tf = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION").getArray();
    const idx = prim.getIndices()?.getArray();
    const n = idx ? idx.length : pos.length / 3;
    const v = (i) => tf(m, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    for (let t = 0; t < n; t += 3) {
      const a = v(idx ? idx[t] : t),
        b = v(idx ? idx[t + 1] : t + 1),
        c = v(idx ? idx[t + 2] : t + 2);
      if (Math.min(a[1], b[1], c[1]) > cap) continue;
      tris.push([a, b, c]);
      for (const p of [a, b, c]) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[2]);
        maxZ = Math.max(maxZ, p[2]);
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
      }
    }
  }
}

const W = Math.ceil((maxX - minX) / cell) + 1,
  H = Math.ceil((maxZ - minZ) / cell) + 1;
const height = new Float32Array(W * H).fill(-Infinity);
for (const [a, b, c] of tris) {
  const x0 = Math.floor((Math.min(a[0], b[0], c[0]) - minX) / cell),
    x1 = Math.ceil((Math.max(a[0], b[0], c[0]) - minX) / cell);
  const z0 = Math.floor((Math.min(a[2], b[2], c[2]) - minZ) / cell),
    z1 = Math.ceil((Math.max(a[2], b[2], c[2]) - minZ) / cell);
  const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  for (let gz = z0; gz <= z1; gz++)
    for (let gx = x0; gx <= x1; gx++) {
      const px = minX + gx * cell,
        pz = minZ + gz * cell;
      let y;
      if (Math.abs(det) < 1e-9) y = Math.max(a[1], b[1], c[1]);
      else {
        const l1 = ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) / det;
        const l2 = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
        y = l1 * a[1] + l2 * b[1] + l3 * c[1];
      }
      const k = gz * W + gx;
      if (gx >= 0 && gx < W && gz >= 0 && gz < H && y > height[k]) height[k] = y;
    }
}

const px = Buffer.alloc(W * H);
for (let i = 0; i < W * H; i++)
  px[i] = height[i] === -Infinity ? 0 : 30 + Math.round(((height[i] - minY) / (maxY - minY)) * 225);
writeFileSync(`${prefix}.pgm`, Buffer.concat([Buffer.from(`P5\n${W} ${H}\n255\n`), px]));
writeFileSync(
  `${prefix}.json`,
  JSON.stringify({
    minX,
    minZ,
    minY,
    maxY,
    cell,
    W,
    H,
    height: Array.from(height, (h) => (h === -Infinity ? null : +h.toFixed(2))),
  })
);
console.log({ minX, maxX, minZ, maxZ, minY, maxY, W, H, tris: tris.length });
