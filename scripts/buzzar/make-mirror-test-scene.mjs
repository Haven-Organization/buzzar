#!/usr/bin/env node
// Generates public/gltf/test/mirror-room.glb: Buzzar's general debug/physics test room ("Buzzar Test Room" on
// matrix.org). It started as the HAVEN_mirror test; add new test fixtures here rather than making new rooms.
//
//   node scripts/buzzar/make-mirror-test-scene.mjs
//   open http://localhost:3000/viewer?src=/gltf/test/mirror-room.glb
//
// Contents:
// - Back wall mirror (3×2 m), starts "high", click it or the red button beside it to cycle Off → High → Low.
// - Side wall mirror starting "low" (avatars only), so both modes can be compared side by side.
// - Coloured pillars + a large green block behind the spawn point: visible in "high" reflections,
//   absent from "low" ones.
// - Avatar pedestals (Default, Devil, Rose) along the right wall.
// - An 8 m ladder (HAVEN_climbable) up to a platform, past the front-left corner: tall enough to jump onto it
//   partway up without being near the top.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Optional: --back-state=off|low|high (default high) and --out=<file name in public/gltf/test/>.
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);
// The mirror you spawn facing starts on (high), so avatars under test are on show straight away.
const backState = args["back-state"] ?? "high";
const spawnZ = Number(args["spawn-z"] ?? 1.5);
const spawnX = Number(args["spawn-x"] ?? 0);
const spawnYaw = Number(args["spawn-yaw"] ?? 180);
// Avatar URIs for the pedestals: relative to this .glb for local testing, or mxc:// for a Matrix world.
const devilUri = args["devil-uri"] ?? "../../../avatars/031_Devil.vrm";
const roseUri = args["rose-uri"] ?? "../../../avatars/057_Rose.vrm";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../../public/gltf/test", args.out ?? "mirror-room.glb");

const bin = [];
let binLength = 0;
const bufferViews = [];
const accessors = [];

function pushBuffer(typedArray, target) {
  const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  const padding = (4 - (binLength % 4)) % 4;
  if (padding) {
    bin.push(new Uint8Array(padding));
    binLength += padding;
  }
  bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.byteLength, target });
  bin.push(bytes);
  binLength += bytes.byteLength;
  return bufferViews.length - 1;
}

function pushAccessor(typedArray, type, componentType, target, minMax) {
  const view = pushBuffer(typedArray, target);
  const components = { SCALAR: 1, VEC3: 3 }[type];
  const accessor = { bufferView: view, componentType, count: typedArray.length / components, type };
  if (minMax) Object.assign(accessor, minMax);
  accessors.push(accessor);
  return accessors.length - 1;
}

// Axis-aligned box centred on the origin.
function boxGeometry(w, h, d) {
  const [x, y, z] = [w / 2, h / 2, d / 2];
  const faces = [
    {
      n: [1, 0, 0],
      v: [
        [x, -y, z],
        [x, -y, -z],
        [x, y, -z],
        [x, y, z],
      ],
    },
    {
      n: [-1, 0, 0],
      v: [
        [-x, -y, -z],
        [-x, -y, z],
        [-x, y, z],
        [-x, y, -z],
      ],
    },
    {
      n: [0, 1, 0],
      v: [
        [-x, y, z],
        [x, y, z],
        [x, y, -z],
        [-x, y, -z],
      ],
    },
    {
      n: [0, -1, 0],
      v: [
        [-x, -y, -z],
        [x, -y, -z],
        [x, -y, z],
        [-x, -y, z],
      ],
    },
    {
      n: [0, 0, 1],
      v: [
        [-x, -y, z],
        [x, -y, z],
        [x, y, z],
        [-x, y, z],
      ],
    },
    {
      n: [0, 0, -1],
      v: [
        [x, -y, -z],
        [-x, -y, -z],
        [-x, y, -z],
        [x, y, -z],
      ],
    },
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  faces.forEach((face, i) => {
    for (const v of face.v) {
      positions.push(...v);
      normals.push(...face.n);
    }
    const o = i * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
    min: [-x, -y, -z],
    max: [x, y, z],
  };
}

const materials = [];
function material(name, rgb, metallic = 0, roughness = 0.6) {
  materials.push({
    name,
    pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: metallic, roughnessFactor: roughness },
  });
  return materials.length - 1;
}

const meshes = [];
function boxMesh(name, size, materialIndex) {
  const g = boxGeometry(...size);
  const POSITION = pushAccessor(g.positions, "VEC3", 5126, 34962, { min: g.min, max: g.max });
  const NORMAL = pushAccessor(g.normals, "VEC3", 5126, 34962);
  const indices = pushAccessor(g.indices, "SCALAR", 5123, 34963);
  meshes.push({ name, primitives: [{ attributes: { POSITION, NORMAL }, indices, material: materialIndex }] });
  return meshes.length - 1;
}

const colliders = [];
function boxCollider(size) {
  colliders.push({ type: "box", extents: size.map((s) => s / 2) });
  return colliders.length - 1;
}

const nodes = [];

const images = [];
function image(path) {
  const bytes = readFileSync(resolve(here, "../../public", path));
  images.push({ bufferView: pushBuffer(new Uint8Array(bytes)), mimeType: "image/png" });
  return images.length - 1;
}
function node(def) {
  nodes.push(def);
  return nodes.length - 1;
}

/** A solid box with a matching collider. */
function solid(name, size, translation, materialIndex, { extensions = {}, ...extra } = {}) {
  return node({
    name,
    translation,
    mesh: boxMesh(name, size, materialIndex),
    extensions: { OMI_collider: { collider: boxCollider(size) }, ...extensions },
    ...extra,
  });
}

const rotY = (deg) => {
  const r = (deg * Math.PI) / 180 / 2;
  return [0, Math.sin(r), 0, Math.cos(r)];
};

const grey = material("Floor", [0.45, 0.45, 0.48]);
const wall = material("Wall", [0.75, 0.72, 0.68]);
const frame = material("Frame", [0.08, 0.08, 0.09], 0.2, 0.4);
const red = material("Toggle", [0.85, 0.1, 0.1]);
const colours = [
  material("Orange", [0.95, 0.45, 0.05]),
  material("Blue", [0.1, 0.3, 0.9]),
  material("Purple", [0.6, 0.15, 0.8]),
  material("Yellow", [0.95, 0.85, 0.1]),
];
const green = material("Green", [0.1, 0.75, 0.25]);

const rootChildren = [];

rootChildren.push(solid("Floor", [16, 0.2, 24], [0, -0.1, 4], grey));
rootChildren.push(solid("BackWall", [16, 4, 0.2], [0, 2, -6.1], wall));
rootChildren.push(solid("LeftWall", [0.2, 4, 16], [-6.1, 2, 0], wall));

// Back-wall mirror (starts "high") with a separate toggle button.
rootChildren.push(solid("BackMirrorFrame", [3.3, 2.3, 0.1], [0, 1.6, -5.95], frame));
const backToggle = solid("BackMirrorToggle", [0.3, 0.3, 0.15], [2.1, 1.2, -5.9], red);
rootChildren.push(backToggle);
rootChildren.push(
  node({
    name: "BackMirror",
    translation: [0, 1.6, -5.88],
    extensions: { HAVEN_mirror: { size: [3, 2], defaultState: backState, toggles: [backToggle] } },
  })
);

// Side-wall mirror (starts "low" = avatars only), facing +X.
rootChildren.push(solid("SideMirrorFrame", [0.1, 2.3, 3.3], [-5.95, 1.6, 0], frame));
rootChildren.push(
  node({
    name: "SideMirror",
    translation: [-5.88, 1.6, 0],
    rotation: rotY(90),
    extensions: { HAVEN_mirror: { size: [3, 2], defaultState: args["side-state"] ?? "off" } },
  })
);

// World props that should appear in "high" reflections and never in "low" ones.
// Kept out of the pedestals' line of sight (they face -X across z = -3…3), so nothing stands in front of them.
[
  [-4, 0.75, -4.8],
  [3, 0.75, -4.8],
  [-4, 0.75, 4.8],
  [-2, 0.75, 4.8],
].forEach((t, i) => rootChildren.push(solid(`Pillar${i}`, [0.6, 1.5, 0.6], t, colours[i])));
rootChildren.push(solid("BigGreenBlock", [4, 2.5, 1], [1.5, 1.25, 5.5], green));

// Avatar pedestals along the right wall, facing into the room (-X).
const podium = material("Podium", [0.2, 0.22, 0.28], 0.1, 0.5);
const pedestals = [
  {
    z: -3,
    avatar: {
      name: "Default",
      author: "Third Room",
      license: "Apache-2.0",
      description: "The built-in mannequin.",
    },
  },
  {
    z: 0,
    image: "gltf/test/images/devil-portrait.png",
    avatar: {
      uri: devilUri,
      name: "Devil",
      author: "Polygonal Mind",
      license: "CC0 1.0",
      description: "100 Avatars #031",
    },
  },
  {
    z: 3,
    image: "gltf/test/images/rose-portrait.png",
    avatar: {
      uri: roseUri,
      name: "Rose",
      author: "Polygonal Mind",
      license: "CC0 1.0",
      description: "100 Avatars #057",
    },
  },
];
pedestals.forEach((p, i) => {
  rootChildren.push(solid(`Podium${i}`, [1.1, 0.3, 1.1], [4.5, 0.15, p.z], podium));
  const extension = { avatar: p.avatar, previewHeight: 1.2 };
  if (p.image) extension.image = image(p.image);
  rootChildren.push(
    node({
      name: `Pedestal ${p.avatar.name}`,
      translation: [4.5, 0.3, p.z],
      rotation: rotY(-90),
      extensions: { HAVEN_avatar_pedestal: extension },
    })
  );
});

// Ladder test: an 8 m ladder on the -Z face of a platform, climbed only from inside the room (facing +Z). It's
// turned half round so its front (the node's +Z) looks into the room, and marked climbable from the front only.
const ladderWood = material("Ladder", [0.74, 0.6, 0.45]);
const platformTop = 8;
rootChildren.push(solid("LadderPlatform", [4, 0.2, 4], [-3.5, platformTop - 0.1, 10], grey));
rootChildren.push(
  solid("Ladder", [0.6, platformTop, 0.1], [-3.5, platformTop / 2, 7.95], ladderWood, {
    rotation: rotY(180),
    extensions: { HAVEN_climbable: { sides: "front" } },
  })
);

// Lights
rootChildren.push(
  node({
    name: "Sun",
    rotation: [-0.42, 0.25, 0.12, 0.86],
    extensions: { KHR_lights_punctual: { light: 0 } },
  })
);
rootChildren.push(node({ name: "Fill", translation: [0, 3.5, 0], extensions: { KHR_lights_punctual: { light: 1 } } }));

// Spawn facing the back mirror (-Z).
rootChildren.push(
  node({
    name: "SpawnPoint",
    translation: [spawnX, 0, spawnZ],
    rotation: rotY(spawnYaw),
    extensions: { MX_spawn_point: {} },
  })
);

const gltf = {
  asset: { version: "2.0", generator: "buzzar make-mirror-test-scene" },
  extensionsUsed: ["KHR_lights_punctual", "OMI_collider", "MX_spawn_point", "HAVEN_mirror", "HAVEN_avatar_pedestal", "HAVEN_climbable"],
  extensions: {
    KHR_lights_punctual: {
      lights: [
        { type: "directional", color: [1, 0.97, 0.92], intensity: 2.5 },
        { type: "point", color: [1, 1, 1], intensity: 40, range: 30 },
      ],
    },
    OMI_collider: { colliders },
  },
  scene: 0,
  scenes: [{ name: "MirrorRoom", nodes: rootChildren }],
  nodes,
  meshes,
  materials,
  ...(images.length ? { images } : {}),
  accessors,
  bufferViews,
  buffers: [{ byteLength: 0 }],
};

// Assemble GLB
const binChunk = new Uint8Array(Math.ceil(binLength / 4) * 4);
let offset = 0;
for (const part of bin) {
  binChunk.set(part, offset);
  offset += part.byteLength;
}
gltf.buffers[0].byteLength = binChunk.byteLength;

const jsonText = JSON.stringify(gltf);
const jsonBytes = new TextEncoder().encode(jsonText);
const jsonChunk = new Uint8Array(Math.ceil(jsonBytes.byteLength / 4) * 4).fill(0x20);
jsonChunk.set(jsonBytes);

const total = 12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength;
const glb = new Uint8Array(total);
const view = new DataView(glb.buffer);
view.setUint32(0, 0x46546c67, true);
view.setUint32(4, 2, true);
view.setUint32(8, total, true);
view.setUint32(12, jsonChunk.byteLength, true);
view.setUint32(16, 0x4e4f534a, true); // JSON
glb.set(jsonChunk, 20);
const binHeader = 20 + jsonChunk.byteLength;
view.setUint32(binHeader, binChunk.byteLength, true);
view.setUint32(binHeader + 4, 0x004e4942, true); // BIN
glb.set(binChunk, binHeader + 8);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, glb);
console.log(`wrote ${outPath} (${total} bytes, ${nodes.length} nodes)`);
