// Compresses a finished Buzzar world (or avatar) for download size, keeping everything else exactly as it is:
// - geometry: quantized (KHR_mesh_quantization) and meshopt-compressed (EXT_meshopt_compression);
// - textures: WebP (EXT_texture_webp), which keeps alpha, at the given quality.
//
// Unlike optimize-world.mjs it never merges, reorders or prunes nodes, materials, scenes or meshes, so Buzzar's own
// extensions (HAVEN_*, MX_*, OMI_* …), which gltf-transform doesn't know and would drop, are saved first and put
// back afterwards by index. Textures are different: gltf-transform rebuilds them from material use, so one used only by
// an extension (a sky, a reflection probe, a lightmap) disappears and the rest may move. They're matched up again by
// image name, missing ones are recreated, and texture/image indices inside the saved extensions are remapped.
// It refuses to write if anything can't be matched.
//
// Needs Buzzar with compressed-file support (2026-11-17 or later) to load the result.
// Usage: node compress-world.mjs <in.glb> <out.glb> [--quality 85] [--no-textures] [--no-geometry]
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const args = process.argv.slice(2);
const [input, output] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--quality"));
const quality = Number(args[args.indexOf("--quality") + 1]) || 85;
const doTextures = !args.includes("--no-textures");
const doGeometry = !args.includes("--no-geometry");
if (!input || !output) {
  console.error("Usage: node compress-world.mjs <in.glb> <out.glb> [--quality 85] [--no-textures] [--no-geometry]");
  process.exit(1);
}

// --- GLB JSON helpers -------------------------------------------------------------------------------------------
function readGLB(path) {
  const b = readFileSync(path);
  const jsonLength = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLength).toString("utf8"));
  const binStart = 20 + jsonLength;
  const bin = binStart < b.length ? b.subarray(binStart + 8, binStart + 8 + b.readUInt32LE(binStart)) : Buffer.alloc(0);
  return { json, bin };
}
function writeGLB(path, json, bin) {
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const pad = Buffer.alloc((4 - (bin.length % 4)) % 4);
  const body = Buffer.concat([bin, pad]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + js.length + 8 + body.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(js.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(body.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path, Buffer.concat([header, jh, js, bh, body]));
}

// --- Save the extensions gltf-transform doesn't know -------------------------------------------------------------
const known = new Set(ALL_EXTENSIONS.map((e) => e.EXTENSION_NAME));
const original = readGLB(input).json;
// Kept in place: these must come out in the same order. Textures are remapped instead (see the top comment).
const GROUPS = ["nodes", "materials", "scenes", "meshes"];
const saved = { root: {}, used: (original.extensionsUsed ?? []).filter((n) => !known.has(n)) };
const customOf = (item) =>
  Object.fromEntries(Object.entries(item.extensions ?? {}).filter(([name]) => !known.has(name)));
for (const group of [...GROUPS, "textures"]) saved[group] = (original[group] ?? []).map(customOf);
saved.root = customOf(original);
const names = (json, group) => (json[group] ?? []).map((item) => item.name ?? "");
if (saved.used.length) console.log("keeping", saved.used.join(", "));

// --- Compress ------------------------------------------------------------------------------------------------------
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(input);
if (doTextures) await doc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", quality }));
if (doGeometry) {
  await MeshoptEncoder.ready;
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
}
const tmp = `${output}.tmp.glb`;
await io.write(tmp, doc);

// --- Put the saved extensions back ---------------------------------------------------------------------------------
const { json, bin } = readGLB(tmp);
const fail = (why) => {
  console.error(`Refusing to write: ${why}`);
  (await_unlink)();
  process.exit(2);
};
const await_unlink = () => {
  try {
    unlinkSync(tmp);
  } catch {
    // already gone
  }
};

// Images: by name (or by position when nothing is named and the count is unchanged).
const origImages = original.images ?? [];
const outImages = json.images ?? [];
const imageMap = origImages.map((image, i) => {
  if (image.name) return outImages.findIndex((o) => o.name === image.name);
  return origImages.length === outImages.length && !outImages[i]?.name ? i : -1;
});
// Textures: the output texture showing the same image (plain or WebP), or a new one.
json.textures ??= [];
const textureMap = (original.textures ?? []).map((texture) => {
  const image = imageMap[texture.source ?? texture.extensions?.EXT_texture_webp?.source ?? -1];
  if (image === undefined || image < 0) return -1;
  const found = json.textures.findIndex(
    (t) => (t.source ?? t.extensions?.EXT_texture_webp?.source) === image && t.sampler === texture.sampler
  );
  if (found >= 0) return found;
  const webp = outImages[image]?.mimeType === "image/webp";
  json.textures.push({
    name: texture.name,
    ...(texture.sampler !== undefined ? { sampler: texture.sampler } : {}),
    ...(webp ? { extensions: { EXT_texture_webp: { source: image } } } : { source: image }),
  });
  return json.textures.length - 1;
});
if (original.samplers?.length && JSON.stringify(original.samplers) !== JSON.stringify(json.samplers ?? [])) {
  // New texture entries reuse the original sampler indices; copy the samplers over so they still mean the same.
  json.samplers = original.samplers;
}

// Rewrite texture ("…Texture": { index }) and image ("image": n) references inside the saved extensions.
const remap = (value, key) => {
  if (Array.isArray(value)) return value.map((v) => remap(v, key));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "index" && typeof v === "number" && /texture/i.test(key ?? "")) {
        if (textureMap[v] === undefined || textureMap[v] < 0) fail(`texture ${v} (used by ${key}) not found`);
        out[k] = textureMap[v];
      } else if (k === "image" && typeof v === "number") {
        if (imageMap[v] === undefined || imageMap[v] < 0) fail(`image ${v} not found`);
        out[k] = imageMap[v];
      } else out[k] = remap(v, k);
    }
    return out;
  }
  return value;
};

for (const group of GROUPS) {
  const before = names(original, group);
  const after = names(json, group);
  if (before.length !== after.length || before.some((n, i) => n !== after[i])) {
    fail(`${group} changed order or count (${before.length} → ${after.length})`);
  }
  (json[group] ?? []).forEach((item, i) => {
    const extra = remap(saved[group][i]);
    if (Object.keys(extra).length) item.extensions = { ...(item.extensions ?? {}), ...extra };
  });
}
saved.textures.forEach((extra, i) => {
  if (!Object.keys(extra).length) return;
  const t = json.textures[textureMap[i]];
  if (!t) fail(`texture ${i} (with ${Object.keys(extra).join(", ")}) not found`);
  t.extensions = { ...(t.extensions ?? {}), ...remap(extra) };
});
if (Object.keys(saved.root).length) json.extensions = { ...(json.extensions ?? {}), ...remap(saved.root) };
json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), ...saved.used])];
writeGLB(output, json, bin);
unlinkSync(tmp);

const size = (p) => readFileSync(p).length;
const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(
  `${input} (${mb(size(input))} MB) → ${output} (${mb(size(output))} MB), requires: ${(json.extensionsRequired ?? []).join(", ")}`
);
