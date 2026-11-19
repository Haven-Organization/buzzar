// Composes Buzzar's default Home World from CC0 parts (Kenney Nature Kit, Poly Haven textures).
// Buzzar features are tagged as node extras (HAVEN_*, MX_*); scripts/buzzar/finish-world.mjs promotes them.
// Usage: node compose-home.mjs <kenney GLTF dir> <grass.jpg> <paving.jpg> <out.glb>
import { readFileSync } from "node:fs";
import { Document, getBounds, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRLightsPunctual } from "@gltf-transform/extensions";
import { dedup, join, mergeDocuments, prune, unpartition, weld } from "@gltf-transform/functions";

const [kenneyDir, grassPath, pavingPath, outPath] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene("Buzzar Home");
doc.getRoot().setDefaultScene(scene);

let seed = 20261115;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const yawQuat = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
// Mesh-less marker nodes (seats, mirror, pedestals) are added after join(), whose cleanup drops empty nodes.
const markers = [];
const marker = (name, translation, rotation, extras) => markers.push({ name, translation, rotation, extras });
const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);

function material(name, color, roughness = 0.9, metallic = 0) {
  return doc.createMaterial(name).setBaseColorFactor(color).setRoughnessFactor(roughness).setMetallicFactor(metallic);
}
function textured(name, path, tint, roughness = 1) {
  const texture = doc.createTexture(name).setImage(readFileSync(path)).setMimeType("image/jpeg");
  const m = material(name, tint, roughness).setBaseColorTexture(texture);
  m.getBaseColorTextureInfo().setWrapS(10497).setWrapT(10497);
  return m;
}

function quad(name, x0, z0, x1, z1, y, mat, tile) {
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", acc("VEC3", new Float32Array([x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0])))
    .setAttribute("NORMAL", acc("VEC3", new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])))
    .setAttribute("TEXCOORD_0", acc("VEC2", new Float32Array([x0 / tile, z0 / tile, x0 / tile, z1 / tile, x1 / tile, z1 / tile, x1 / tile, z0 / tile])))
    .setIndices(acc("SCALAR", new Uint16Array([0, 1, 2, 0, 2, 3])))
    .setMaterial(mat);
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
}

function box(name, size, center, mat, extras) {
  const [sx, sy, sz] = size.map((v) => v / 2);
  const faces = [
    [[1, 0, 0], [[sx, -sy, -sz], [sx, sy, -sz], [sx, sy, sz], [sx, -sy, sz]]],
    [[-1, 0, 0], [[-sx, -sy, sz], [-sx, sy, sz], [-sx, sy, -sz], [-sx, -sy, -sz]]],
    [[0, 1, 0], [[-sx, sy, -sz], [-sx, sy, sz], [sx, sy, sz], [sx, sy, -sz]]],
    [[0, -1, 0], [[-sx, -sy, sz], [-sx, -sy, -sz], [sx, -sy, -sz], [sx, -sy, sz]]],
    [[0, 0, 1], [[sx, -sy, sz], [sx, sy, sz], [-sx, sy, sz], [-sx, -sy, sz]]],
    [[0, 0, -1], [[-sx, -sy, -sz], [-sx, sy, -sz], [sx, sy, -sz], [sx, -sy, -sz]]],
  ];
  const pos = [], nrm = [], idx = [];
  faces.forEach(([n, vs], f) => {
    vs.forEach((v) => { pos.push(...v); nrm.push(...n); });
    idx.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  });
  const prim = doc.createPrimitive()
    .setAttribute("POSITION", acc("VEC3", new Float32Array(pos)))
    .setAttribute("NORMAL", acc("VEC3", new Float32Array(nrm)))
    .setIndices(acc("SCALAR", new Uint16Array(idx)))
    .setMaterial(mat);
  const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)).setTranslation(center);
  if (extras) node.setExtras(extras);
  scene.addChild(node);
  return node;
}

// --- Kenney props (meshes merged in once, placed by new nodes) ---
const templates = {};
async function template(name) {
  if (templates[name]) return templates[name];
  const src = await io.read(`${kenneyDir}/${name}.glb`);
  const srcMeshes = src.getRoot().listMeshes();
  const box3 = getBounds(src.getRoot().listScenes()[0]);
  const map = mergeDocuments(doc, src);
  for (const s of doc.getRoot().listScenes()) if (s !== scene) s.dispose();
  return (templates[name] = { meshes: srcMeshes.map((m) => map.get(m)), min: box3.min, max: box3.max });
}
async function place(name, x, z, { width, height, yaw = 0, y = 0, nodeName, extras } = {}) {
  const t = await template(name);
  const w = Math.max(t.max[0] - t.min[0], t.max[2] - t.min[2]);
  const h = t.max[1] - t.min[1];
  const s = width ? width / w : height ? height / h : 1;
  const nodes = t.meshes.map((mesh, i) => {
    const node = doc.createNode(i === 0 ? nodeName : undefined).setMesh(mesh)
      .setTranslation([x, y - t.min[1] * s, z]).setScale([s, s, s]).setRotation(yawQuat(yaw));
    if (extras && i === 0) node.setExtras(extras);
    scene.addChild(node);
    return node;
  });
  return { nodes, scale: s, top: y + h * s };
}

// --- Ground ---
quad("Grass", -40, -40, 40, 40, 0, textured("Grass", grassPath, [0.62, 0.9, 0.42, 1]), 4);
quad("Plaza", -7, -8.5, 7, 7.5, 0.02, textured("Plaza paving", pavingPath, [0.9, 0.88, 0.84, 1], 0.95), 2);

// --- Campfire with log seats ---
await place("campfire_stones", 0, 0, { width: 1.4 });
await place("campfire_logs", 0, 0, { width: 1.0, y: 0.02 });
const fireLight = doc.createExtension(KHRLightsPunctual).createLight("Campfire").setType("point")
  .setColor([1, 0.55, 0.22]).setIntensity(4).setRange(10);
scene.addChild(doc.createNode("Campfire light").setTranslation([0, 0.7, 0]).setExtension("KHR_lights_punctual", fireLight));

const SEAT_RADIUS = 2.3;
for (let i = 0; i < 4; i++) {
  const a = Math.PI / 4 + (i * Math.PI) / 2; // logs at the diagonals, leaving the south approach open
  const x = Math.sin(a) * SEAT_RADIUS, z = Math.cos(a) * SEAT_RADIUS;
  // The Kenney log's long axis is local X. Rotating by a about +Y maps X to (cos a, 0, -sin a): the tangent of
  // the ring, so the log's long side faces the fire.
  const log = await place("log_large", x, z, { width: 1.7, yaw: a, y: 0.02 });
  // Two places per log, side by side along it, both facing the fire (rig forward is -Z: R(θ)·(0,0,-1) =
  // (-sinθ, 0, -cosθ), which points at the origin for θ = a).
  const tx = Math.cos(a), tz = -Math.sin(a);
  for (const [k, along] of [[1, -0.42], [2, 0.42]]) {
    marker(`Log ${i + 1} seat ${k}`, [x + tx * along, log.top, z + tz * along], yawQuat(a), { HAVEN_seat: { size: [0.55, 0.35, 0.5] } });
  }
}

// --- Grabbable rocks ---
const rocks = [[-2.6, 3.4], [-3.4, 2.6], [3.1, 3.2]];
for (const [i, [x, z]] of rocks.entries()) {
  await place("rock_smallA", x, z, { width: 0.32, yaw: rand() * 6.28, y: 0.02, nodeName: `Grab rock ${i + 1}`, extras: { HAVEN_grabbable: {} } });
}

// --- Mirror behind the fire, facing the spawn (+Z); on from the start, so you arrive looking at yourself ---
const frame = material("Mirror frame", [0.05, 0.05, 0.06, 1], 0.35, 0.3);
box("Mirror frame", [3.3, 2.3, 0.12], [0, 1.4, -6.06], frame);
marker("Mirror", [0, 1.4, -5.99], [0, 0, 0, 1], { HAVEN_mirror: { size: [3, 2], defaultState: "high", clickToToggle: true } });

// --- Avatar pedestals on the east side, facing the plaza (-X) ---
const podium = material("Podium", [0.2, 0.22, 0.28, 1], 0.5, 0.1);
const pedestals = [
  { z: -2.5, avatar: { name: "Default", author: "Third Room", license: "Apache-2.0", description: "The built-in mannequin." } },
  { z: 0, avatar: { uri: "buzzar-builtin:devil", name: "Devil", author: "Polygonal Mind", license: "CC0 1.0", description: "100 Avatars #031" } },
  { z: 2.5, avatar: { uri: "buzzar-builtin:rose", name: "Rose", author: "Polygonal Mind", license: "CC0 1.0", description: "100 Avatars #057" } },
];
for (const p of pedestals) {
  box(`Podium ${p.avatar.name}`, [1.1, 0.3, 1.1], [5.6, 0.17, p.z], podium);
  marker(`Pedestal ${p.avatar.name}`, [5.6, 0.32, p.z], yawQuat(-Math.PI / 2), { HAVEN_avatar_pedestal: { avatar: p.avatar, previewHeight: 1.2 } });
}

// --- Trees around the clearing, bushes and flowers along the plaza ---
const TREES = ["tree_default", "tree_oak", "tree_detailed", "tree_fat", "tree_tall", "tree_default_dark", "tree_oak_dark", "tree_pineRoundB"];
const placed = [];
for (let tries = 0; tries < 8000 && placed.length < 75; tries++) {
  const r = 11 + rand() * 24, a = rand() * Math.PI * 2;
  const x = Math.sin(a) * r, z = Math.cos(a) * r;
  if (placed.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 16)) continue;
  placed.push([x, z]);
  await place(TREES[Math.floor(rand() * TREES.length)], x, z, { height: 6 + rand() * 4, yaw: rand() * 6.28 });
}
const EDGE = ["plant_bushLarge", "plant_bushDetailed", "flower_purpleA", "flower_purpleB", "flower_yellowA", "flower_redA"];
for (let i = 0; i < 46; i++) {
  // Points just outside the plaza rectangle (x ±7, z -8.5…7.5), skipping the south entrance.
  const side = Math.floor(rand() * 4), t = rand();
  let x, z;
  if (side === 0) { x = -7.8; z = -8.5 + t * 16; } else if (side === 1) { x = 7.8; z = -8.5 + t * 16; }
  else if (side === 2) { x = -7 + t * 14; z = -9.3; } else { x = -7 + t * 14; z = 8.3; if (Math.abs(x) < 2.5) continue; }
  const kind = EDGE[Math.floor(rand() * EDGE.length)];
  await place(kind, x + (rand() - 0.5) * 0.6, z + (rand() - 0.5) * 0.6, { height: kind.startsWith("flower") ? 0.6 : 0.9, yaw: rand() * 6.28 });
}

// Kenney palette → natural colours, rough dielectrics (see the resort world notes).
const lin = (c) => Math.pow(c / 255, 2.2);
const KENNEY = { leafsGreen: [78, 128, 52], leafsDark: [56, 100, 44], woodBark: [112, 82, 58], woodBarkDark: [92, 68, 48], grass: [84, 136, 56],
  colorPurple: [150, 118, 205], colorYellow: [245, 196, 60], colorRed: [214, 70, 76], stone: [128, 126, 120], stoneDark: [92, 90, 86], _defaultMat: [128, 128, 128],
  fire: [255, 150, 40], wood: [120, 86, 56], woodDark: [88, 62, 40], woodInner: [196, 160, 110], dirt: [110, 84, 60] };
for (const m of doc.getRoot().listMaterials()) {
  const srgb = KENNEY[m.getName()];
  for (const ext of m.listExtensions()) if (ext.extensionName !== "KHR_materials_emissive_strength") m.setExtension(ext.extensionName, null);
  if (!srgb) continue;
  m.setBaseColorFactor([lin(srgb[0]), lin(srgb[1]), lin(srgb[2]), 1]).setMetallicFactor(0).setRoughnessFactor(0.9);
}

// Merge static props; named nodes (seats, mirror, pedestals, grabbable rocks) stay separate.
await doc.transform(unpartition(), dedup(), join({ keepNamed: true }), weld(), prune({ keepLeaves: true }));
for (const m of markers) {
  scene.addChild(doc.createNode(m.name).setTranslation(m.translation).setRotation(m.rotation).setExtras(m.extras));
}
await io.write(outPath, doc);
console.log("materials", doc.getRoot().listMaterials().map((m) => m.getName()).join(", "));
console.log("meshes", doc.getRoot().listMeshes().length, "nodes", doc.getRoot().listNodes().length);
