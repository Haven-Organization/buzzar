// Reports NaN / zero-length normals and NaN positions/UVs per primitive (causes NaN pixels → black bloom blowouts).
// Usage: node check-normals.mjs <in.glb> [fix-out.glb]   (with an output path, bad normals are recomputed as +Y... see below)
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [input, fixOut] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
let total = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial()?.getName();
    const report = {};
    for (const semantic of prim.listSemantics()) {
      const arr = prim.getAttribute(semantic).getArray();
      const size = prim.getAttribute(semantic).getElementSize();
      let nan = 0,
        zero = 0;
      for (let i = 0; i < arr.length; i += size) {
        let len = 0,
          bad = false;
        for (let k = 0; k < size; k++) {
          const v = arr[i + k];
          if (!Number.isFinite(v)) bad = true;
          len += v * v;
        }
        if (bad) nan++;
        else if (semantic === "NORMAL" && len < 1e-12) zero++;
      }
      if (nan || zero) report[semantic] = { nan, zero, of: arr.length / size };
      if (fixOut && semantic === "NORMAL" && (nan || zero)) {
        // Replace broken normals with the face normal of a triangle using that vertex.
        const pos = prim.getAttribute("POSITION").getArray();
        const idx = prim.getIndices()?.getArray();
        const n = idx ? idx.length : pos.length / 3;
        for (let t = 0; t < n; t += 3) {
          const [a, b, c] = [0, 1, 2].map((k) => (idx ? idx[t + k] : t + k));
          const e1 = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]);
          const e2 = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
          let f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          const fl = Math.hypot(...f);
          f = fl > 1e-12 ? f.map((v) => v / fl) : [0, 1, 0];
          for (const v of [a, b, c]) {
            const l = Math.hypot(arr[v * 3], arr[v * 3 + 1], arr[v * 3 + 2]);
            if (!Number.isFinite(l) || l < 1e-6) arr.set(f, v * 3);
          }
        }
        prim.getAttribute(semantic).setArray(arr);
      }
    }
    if (Object.keys(report).length) {
      total++;
      console.log(mat, JSON.stringify(report));
    }
  }
}
console.log("primitives with problems:", total);
if (fixOut) {
  await io.write(fixOut, doc);
  console.log("wrote", fixOut);
}
