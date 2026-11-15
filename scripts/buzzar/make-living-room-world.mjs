// Turns the "Low poly living room" diorama .glb into a Buzzar world.
//
// The source is a two-walled diorama modelled at roughly 2.2x real size, with no lights or spawn point.
// This script:
// - wraps the original scene in a root node scaled to roughly real size (default 0.6: ~6.3 m room, 3.2 m ceiling;
//   0.45 is true-to-life but felt cramped with Buzzar avatars)
// - closes the room with the two missing walls (+X, +Z) and a ceiling, reusing the scene's own materials
// - adds a ceiling lamp (emissive panel + point light) and a soft directional fill
// - adds an MX_spawn_point in the open corner, facing the TV
// - makes the two coffee mugs grabbable (HAVEN_grabbable) and adds seats (HAVEN_seat) to the sofa and armchair
//
// Colliders: no OMI_collider is declared, so the engine builds a trimesh collider for every mesh
// (gltf.game.ts), which makes the furniture and the new walls solid.
//
// Usage: node scripts/buzzar/make-living-room-world.mjs <input.glb> [--out world.glb] [--scale 0.6]
import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const args = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[++i];
  else positional.push(argv[i]);
}
const inPath = positional[0];
if (!inPath) {
  console.error("usage: make-living-room-world.mjs <input.glb> [--out world.glb] [--scale 0.45]");
  process.exit(1);
}
const outPath = args.out ?? inPath.replace(/\.glb$/i, "") + " (Buzzar world).glb";
const scale = Number(args.scale ?? 0.6);

// --- Read GLB ---
const src = readFileSync(inPath);
if (src.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB file");
const jsonLength = src.readUInt32LE(12);
const gltf = JSON.parse(src.subarray(20, 20 + jsonLength).toString("utf8"));
const binStart = 20 + jsonLength;
const binLength = src.readUInt32LE(binStart);
const parts = [src.subarray(binStart + 8, binStart + 8 + binLength)];
let byteLength = binLength;

const align4 = () => {
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) {
    parts.push(new Uint8Array(pad));
    byteLength += pad;
  }
};

function addAccessor(typedArray, type, componentType, target, minMax) {
  align4();
  const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  gltf.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, target });
  parts.push(bytes);
  byteLength += bytes.byteLength;
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
  const accessor = {
    bufferView: gltf.bufferViews.length - 1,
    componentType,
    count: typedArray.length / comps,
    type,
  };
  if (minMax) Object.assign(accessor, minMax);
  gltf.accessors.push(accessor);
  return gltf.accessors.length - 1;
}

// Axis-aligned box mesh, outward normals, in the diorama's original units.
function addBoxMesh(name, min, max, material) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const faces = [
    {
      n: [1, 0, 0],
      v: [
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
      ],
    },
    {
      n: [-1, 0, 0],
      v: [
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
        [x0, y0, z0],
      ],
    },
    {
      n: [0, 1, 0],
      v: [
        [x0, y1, z0],
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
    },
    {
      n: [0, -1, 0],
      v: [
        [x0, y0, z1],
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
      ],
    },
    {
      n: [0, 0, 1],
      v: [
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
        [x0, y0, z1],
      ],
    },
    {
      n: [0, 0, -1],
      v: [
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y0, z0],
      ],
    },
  ];
  const positions = new Float32Array(24 * 3);
  const normals = new Float32Array(24 * 3);
  const indices = new Uint16Array(36);
  faces.forEach((face, f) => {
    face.v.forEach((p, i) => {
      positions.set(p, (f * 4 + i) * 3);
      normals.set(face.n, (f * 4 + i) * 3);
    });
    // Winding: CCW seen from outside for the vertex orders above.
    const b = f * 4;
    indices.set([b, b + 1, b + 2, b, b + 2, b + 3], f * 6);
  });
  const POSITION = addAccessor(positions, "VEC3", 5126, 34962, { min: [x0, y0, z0], max: [x1, y1, z1] });
  const NORMAL = addAccessor(normals, "VEC3", 5126, 34962);
  const idx = addAccessor(indices, "SCALAR", 5123, 34963);
  gltf.meshes.push({ name, primitives: [{ attributes: { POSITION, NORMAL }, indices: idx, material }] });
  return gltf.meshes.length - 1;
}

const materialIndex = (name) => {
  const i = gltf.materials.findIndex((m) => m.name === name);
  if (i < 0) throw new Error(`material "${name}" not found in source`);
  return i;
};

// --- Wrap the original scene in a scaled root ---
const scene = gltf.scenes[gltf.scene ?? 0];
const GRABBABLE = new Set(["Mug", "Mug.001"]);
const roomChildren = scene.nodes.filter((i) => !GRABBABLE.has(gltf.nodes[i].name));
// Grabbables live at the top level in world units: picked-up copies are created at the world root.
const grabbables = scene.nodes.filter((i) => GRABBABLE.has(gltf.nodes[i].name));
for (const i of grabbables) {
  const n = gltf.nodes[i];
  n.translation = (n.translation ?? [0, 0, 0]).map((v) => v * scale);
  n.scale = (n.scale ?? [1, 1, 1]).map((v) => v * scale);
  n.extensions = { ...(n.extensions ?? {}), HAVEN_grabbable: {} };
}
const addNode = (n) => {
  gltf.nodes.push(n);
  return gltf.nodes.length - 1;
};

// Room shell in original units: floor spans -5.5..5 on X/Z with its top at y=0, walls 0.5 thick up to y=5.35.
const WALL = materialIndex("Grey");
const CEILING = materialIndex("White");
const top = 5.35;
roomChildren.push(
  addNode({ name: "Wall +X", mesh: addBoxMesh("Wall +X", [5, -0.65, -5.5], [5.5, top, 5.5], WALL) }),
  addNode({ name: "Wall +Z", mesh: addBoxMesh("Wall +Z", [-5.5, -0.65, 5], [5, top, 5.5], WALL) }),
  addNode({ name: "Ceiling", mesh: addBoxMesh("Ceiling", [-5.5, top, -5.5], [5.5, top + 0.5, 5.5], CEILING) })
);

// Ceiling lamp: a thin glowing panel plus a point light just below it.
gltf.materials.push({
  name: "Lamp",
  emissiveFactor: [1, 0.92, 0.78],
  pbrMetallicRoughness: { baseColorFactor: [1, 0.95, 0.85, 1], metallicFactor: 0, roughnessFactor: 1 },
});
const LAMP = gltf.materials.length - 1;
roomChildren.push(
  addNode({ name: "Ceiling lamp", mesh: addBoxMesh("Ceiling lamp", [-0.9, top - 0.12, -1.4], [0.9, top, 0.4], LAMP) })
);

const root = addNode({ name: "LivingRoom", scale: [scale, scale, scale], children: roomChildren });

gltf.extensions = gltf.extensions ?? {};
gltf.extensions.KHR_lights_punctual = {
  lights: [
    { name: "Ceiling lamp", type: "point", color: [1, 0.9, 0.78], intensity: 1.5, range: 8 },
    { name: "Fill", type: "directional", color: [0.9, 0.93, 1], intensity: 1.5 },
    { name: "Back fill", type: "directional", color: [1, 0.95, 0.9], intensity: 0.6 },
  ],
};
const lampLight = addNode({
  name: "Ceiling lamp light",
  // ~1 m below the ceiling: close enough to light the room, far enough not to blow out the ceiling.
  translation: [0, top * scale - 1.0, -0.5 * scale],
  extensions: { KHR_lights_punctual: { light: 0 } },
});
const fill = addNode({
  name: "Fill light",
  rotation: [-0.35, 0.3, 0.12, 0.88],
  extensions: { KHR_lights_punctual: { light: 1 } },
});

const backFill = addNode({
  name: "Back fill light",
  rotation: [-0.25, 0.9, 0.12, 0.33],
  extensions: { KHR_lights_punctual: { light: 2 } },
});

// Seats: the node marks where the hips go (top of the seat cushion, towards the back); the sitter faces the
// node's -Z. Measured from the meshes: cushions top out at y≈1.06 (sofa) / 1.09 (armchair), backrests start
// just behind local z≈0, and both face their local -Z. Positions below are in the diorama's original units.
const seatDefs = [
  { name: "Sofa seat left", at: [-0.95, 1.06, 2.895 - 0.3], yaw: 0 },
  { name: "Sofa seat middle", at: [0, 1.06, 2.895 - 0.3], yaw: 0 },
  { name: "Sofa seat right", at: [0.95, 1.06, 2.895 - 0.3], yaw: 0 },
  // Armchair: rotated +90° about Y at (3.28, 0, -0.53), so its local -Z faces world -X.
  { name: "Armchair seat", at: [3.28 - 0.3, 1.09, -0.53], yaw: 90 },
];
const seats = seatDefs.map(({ name, at, yaw }) => {
  const r = (yaw * Math.PI) / 180 / 2;
  return addNode({
    name,
    translation: at.map((v) => v * scale),
    rotation: [0, Math.sin(r), 0, Math.cos(r)],
    extensions: { HAVEN_seat: { size: [0.55, 0.3, 0.55] } },
  });
});

// Spawn in the open corner (behind the armchair side), facing the TV corner (-X, -Z).
const yaw = (Number(args["spawn-yaw"] ?? 225) * Math.PI) / 180 / 2;
const spawn = addNode({
  name: "SpawnPoint",
  translation: [3.6 * scale, 0, 3.6 * scale],
  rotation: [0, Math.sin(yaw), 0, Math.cos(yaw)],
  extensions: { MX_spawn_point: {} },
});

scene.name = "Living Room";
scene.nodes = [root, ...grabbables, ...seats, lampLight, fill, backFill, spawn];
gltf.extensionsUsed = [
  ...new Set([
    ...(gltf.extensionsUsed ?? []),
    "KHR_lights_punctual",
    "MX_spawn_point",
    "HAVEN_seat",
    "HAVEN_grabbable",
  ]),
];
gltf.asset.generator = `${gltf.asset.generator ?? "unknown"} + buzzar make-living-room-world`;

// --- Write GLB ---
align4();
const bin = Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength)));
gltf.buffers = [{ byteLength: bin.byteLength }];
const jsonBytes = Buffer.from(JSON.stringify(gltf), "utf8");
const jsonPadded = Buffer.alloc(Math.ceil(jsonBytes.length / 4) * 4, 0x20);
jsonBytes.copy(jsonPadded);
const total = 12 + 8 + jsonPadded.length + 8 + bin.length;
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);
header.writeUInt32LE(jsonPadded.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);
writeFileSync(outPath, Buffer.concat([header, jsonPadded, binHeader, bin]));
console.log(`wrote ${outPath} (${total} bytes, scale ${scale})`);
