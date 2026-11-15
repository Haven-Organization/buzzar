// Finishes an imported scene as a Buzzar world: wraps it in a root node that puts the walkable ground at y=0 and
// centres it on the origin, then adds a sun + fill light and an MX_spawn_point. Mesh colliders are left to the
// engine (every mesh becomes a static trimesh when the scene declares no OMI_collider).
//
// Pairs with an optimisation pass for heavy downloads (draw-call merging, texture resizing), e.g. the
// gltf-transform v4 steps described in docs/buzzar/importing-worlds.md.
//
// Usage:
//   node scripts/buzzar/finish-world.mjs <in.glb> --out <out.glb> --ground <y> [--spawn x,z,yawDeg]
//     [--center x,z] [--name "Scene name"] [--sun intensity (default 1.4)] [--fill intensity (default 0.6)] [--lighting even] [--sky sky.hdr]
// Node extras named HAVEN_*/MX_*/OMI_* are promoted to extensions (see below).
// --sky embeds an equirectangular .hdr as the background (MX_background) and lighting (MX_reflection_probes).
// Coordinates are in the input's space; yaw 0 faces +Z, 180 faces -Z.
import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const args = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[++i];
  else positional.push(argv[i]);
}
const inPath = positional[0];
if (!inPath || !args.out || args.ground === undefined) {
  console.error("usage: finish-world.mjs <in.glb> --out <out.glb> --ground <y> [--spawn x,z,yaw] [--center x,z]");
  process.exit(1);
}
const ground = Number(args.ground);
const [cx, cz] = (args.center ?? "0,0").split(",").map(Number);
const [sx, sz, syaw] = (args.spawn ?? `${cx},${cz},180`).split(",").map(Number);

const src = readFileSync(inPath);
if (src.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB file");
const jsonLength = src.readUInt32LE(12);
const gltf = JSON.parse(src.subarray(20, 20 + jsonLength).toString("utf8"));
const binStart = 20 + jsonLength;
let bin = src.subarray(binStart + 8, binStart + 8 + src.readUInt32LE(binStart));

const scene = gltf.scenes[gltf.scene ?? 0];

// Tools like gltf-transform drop extensions they don't know, so composition scripts tag nodes through
// `extras` instead (e.g. extras.HAVEN_seat = {...}); promote those to real extensions here.
for (const node of gltf.nodes) {
  if (!node.extras) continue;
  for (const key of Object.keys(node.extras)) {
    if (!/^(HAVEN_|MX_|OMI_)/.test(key)) continue;
    node.extensions = { ...(node.extensions ?? {}), [key]: node.extras[key] };
    gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed ?? []), key])];
    delete node.extras[key];
  }
  if (Object.keys(node.extras).length === 0) delete node.extras;
}

if (args.sky) {
  const hdr = readFileSync(args.sky);
  const offset = Math.ceil(bin.length / 4) * 4;
  bin = Buffer.concat([bin, Buffer.alloc(offset - bin.length), hdr]);
  gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: hdr.length });
  gltf.images = gltf.images ?? [];
  const image = gltf.images.push({ name: "Sky", bufferView: gltf.bufferViews.length - 1, mimeType: "image/vnd.radiance" }) - 1;
  gltf.textures = gltf.textures ?? [];
  const texture = gltf.textures.push({ name: "Sky", source: image }) - 1;
  gltf.extensions = gltf.extensions ?? {};
  gltf.extensions.MX_reflection_probes = { reflectionProbes: [{ reflectionProbeTexture: { index: texture } }] };
  scene.extensions = {
    ...(scene.extensions ?? {}),
    MX_background: { backgroundTexture: { index: texture } },
    MX_reflection_probes: { reflectionProbe: 0 },
  };
  gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed ?? []), "MX_background", "MX_reflection_probes"])];
}
const addNode = (n) => gltf.nodes.push(n) - 1;

const root = addNode({ name: args.name ?? scene.name ?? "World", translation: [-cx, -ground, -cz], children: scene.nodes });

gltf.extensions = gltf.extensions ?? {};
const lights = (gltf.extensions.KHR_lights_punctual = gltf.extensions.KHR_lights_punctual ?? { lights: [] }).lights;
// --lighting even: four equal lights angled down from N/E/S/W instead of a sun and fill, so every wall gets the
// same light (indoor spaces lit by ceiling panels, e.g. the Backrooms). Intensity per light: --sun.
const evenLighting = args.lighting === "even";
const sunIndex = lights.push({ name: "Sun", type: "directional", color: [1, 0.96, 0.9], intensity: Number(args.sun ?? 1.4) }) - 1;
const fillIndex =
  lights.push({ name: "Sky fill", type: "directional", color: [0.75, 0.85, 1], intensity: Number(args.fill ?? 0.6) }) - 1;
const evenNodes = [];
if (evenLighting) {
  lights.length = 0;
  const colour = [1, 0.97, 0.88];
  for (let i = 0; i < 4; i++) {
    const index = lights.push({ name: `Even light ${i + 1}`, type: "directional", color: colour, intensity: Number(args.sun ?? 0.6) }) - 1;
    // Point down 50° and around the compass: yaw i·90°, pitch -50° (quaternion = yaw * pitch).
    const yaw = (i * Math.PI) / 2, pitch = (-50 * Math.PI) / 180;
    const [cy, sy, cp, sp] = [Math.cos(yaw / 2), Math.sin(yaw / 2), Math.cos(pitch / 2), Math.sin(pitch / 2)];
    evenNodes.push(addNode({ name: `Even light ${i + 1}`, rotation: [cy * sp, sy * cp, -sy * sp, cy * cp], extensions: { KHR_lights_punctual: { light: index } } }));
  }
}
const sun = addNode({ name: "Sun", rotation: [-0.42, 0.25, 0.12, 0.86], extensions: { KHR_lights_punctual: { light: sunIndex } } });
const fill = addNode({ name: "Sky fill", rotation: [0.25, 0.9, -0.3, 0.2], extensions: { KHR_lights_punctual: { light: fillIndex } } });

const half = (syaw * Math.PI) / 180 / 2;
const spawn = addNode({
  name: "SpawnPoint",
  translation: [sx - cx, 0, sz - cz],
  rotation: [0, Math.sin(half), 0, Math.cos(half)],
  extensions: { MX_spawn_point: {} },
});

scene.nodes = evenLighting ? [root, ...evenNodes, spawn] : [root, sun, fill, spawn];
gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed ?? []), "KHR_lights_punctual", "MX_spawn_point"])];
gltf.asset.generator = `${gltf.asset.generator ?? "unknown"} + buzzar finish-world`;

const binPadded = Buffer.concat([bin, Buffer.alloc(Math.ceil(bin.length / 4) * 4 - bin.length)]);
gltf.buffers[0].byteLength = binPadded.length;
const jsonBytes = Buffer.from(JSON.stringify(gltf), "utf8");
const jsonPadded = Buffer.alloc(Math.ceil(jsonBytes.length / 4) * 4, 0x20);
jsonBytes.copy(jsonPadded);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binPadded.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);
const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);
header.writeUInt32LE(jsonPadded.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
writeFileSync(args.out, Buffer.concat([header, jsonPadded, binHeader, binPadded]));
console.log(`wrote ${args.out} (${(total / 1048576).toFixed(1)} MB)`);
