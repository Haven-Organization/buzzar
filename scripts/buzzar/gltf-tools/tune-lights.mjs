// Sets point/spot light intensities (candela) and caps emissive strength — Blender's exporter converts watts to
// candela physically, which is far too bright for a real-time scene.
// Usage: node tune-lights.mjs <in.glb> <out.glb> <pointCandela> <maxEmissiveStrength> [overrides.json]
// overrides.json: { "<material name>": { "color": [r,g,b,a] (linear), "roughness": n, "metallic": n, "alpha": "BLEND"|"MASK"|"OPAQUE" } }
// Used for Blender materials the glTF exporter can't express (procedural textures export as black, glass as opaque).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

import { readFileSync } from "node:fs";
const [inPath, outPath, cdArg, emArg, overridesPath] = process.argv.slice(2);
const overrides = overridesPath ? JSON.parse(readFileSync(overridesPath, "utf8")) : {};
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);
const cd = Number(cdArg),
  maxEmissive = Number(emArg);

for (const node of doc.getRoot().listNodes()) {
  const light = node.getExtension("KHR_lights_punctual");
  if (light && light.getType() !== "directional") light.setIntensity(cd);
}
for (const material of doc.getRoot().listMaterials()) {
  const strength = material.getExtension("KHR_materials_emissive_strength");
  if (strength && strength.getEmissiveStrength() > maxEmissive) strength.setEmissiveStrength(maxEmissive);
}
// Strip material extensions that cause trouble in the engine (clearcoat is unsupported; transmission's extra
// refraction pass produced a black-screen blowout in the convenience store). Glass uses alpha blending instead.
const STRIP = (process.env.STRIP_EXTENSIONS ?? "").split(",").filter(Boolean);
for (const material of doc.getRoot().listMaterials()) {
  for (const ext of material.listExtensions()) {
    if (STRIP.includes(ext.extensionName)) {
      console.log("strip", ext.extensionName, "from", material.getName());
      material.setExtension(ext.extensionName, null);
    }
  }
}
for (const material of doc.getRoot().listMaterials()) {
  const o = overrides[material.getName()];
  if (!o) continue;
  if (o.color) material.setBaseColorFactor(o.color);
  if (o.roughness !== undefined) material.setRoughnessFactor(o.roughness);
  if (o.metallic !== undefined) material.setMetallicFactor(o.metallic);
  if (o.alpha) material.setAlphaMode(o.alpha);
  if (o.doubleSided !== undefined) material.setDoubleSided(o.doubleSided);
  console.log("override", material.getName(), JSON.stringify(o));
}
await io.write(outPath, doc);
console.log(`point/spot lights -> ${cd} cd, emissive strength <= ${maxEmissive}`);
