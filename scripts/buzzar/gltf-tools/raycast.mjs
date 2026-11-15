// Casts rays from a point and reports the first hit's material, distance and triangle normal.
// Usage: node raycast.mjs <in.glb> x y z  (then directions as dx,dy,dz ...)
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [input, xs, ys, zs, ...dirs] = process.argv.slice(2);
const origin = [Number(xs), Number(ys), Number(zs)];
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(input);
const tf = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const tris = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION").getArray();
    const idx = prim.getIndices()?.getArray();
    const n = idx ? idx.length : pos.length / 3;
    const v = (i) => tf(m, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    for (let t = 0; t < n; t += 3)
      tris.push([
        v(idx ? idx[t] : t),
        v(idx ? idx[t + 1] : t + 1),
        v(idx ? idx[t + 2] : t + 2),
        prim.getMaterial()?.getName() ?? "(none)",
      ]);
  }
}
for (const d of dirs) {
  const dir = d.split(",").map(Number);
  let best = null;
  for (const [a, b, c, mat] of tris) {
    const e1 = sub(b, a),
      e2 = sub(c, a),
      p = cross(dir, e2),
      det = dot(e1, p);
    if (Math.abs(det) < 1e-9) continue;
    const s = sub(origin, a),
      u = dot(s, p) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1),
      w = dot(dir, q) / det;
    if (w < 0 || u + w > 1) continue;
    const t = dot(e2, q) / det;
    if (t > 1e-4 && (!best || t < best.t))
      best = { t, mat, normal: cross(e1, e2), facing: dot(cross(e1, e2), dir) < 0 ? "front" : "BACK" };
  }
  console.log(d, best ? `${best.t.toFixed(2)} m  ${best.mat}  ${best.facing}-face` : "no hit");
}
