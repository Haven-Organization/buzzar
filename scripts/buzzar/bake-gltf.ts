/**
 * Bakes Buzzar behaviour and details into a .glb / .vrm so they travel with the file (docs/buzzar/asset-files.md):
 *
 * - `--avatar`: writes `HAVEN_avatar_motion` from what Buzzar would do with the avatar today: its springs (its own,
 *   its VRM ones, or the ones Buzzar finds by bone name: hair, ears, tail, skirt…) and its idle ear motion settings.
 *   Edit the result to tune it; `--no-ear-motion` turns idle ear motion off.
 * - `--name`, `--description` (or `--description-file`, for several lines), `--author`, `--source`, `--version`:
 *   write `HAVEN_metadata` (only the fields given; existing ones are kept).
 *
 * Only the glTF JSON changes; the binary data is copied byte for byte.
 *
 * Usage (from the repo root):
 *   node_modules/.bin/vite-node scripts/buzzar/bake-gltf.ts -- in.glb out.glb --avatar --name "Haru Urara" --version 1
 */
import { readFileSync, writeFileSync } from "node:fs";

import { getHumanoidMapping } from "../../src/engine/avatar/humanoid";
import {
  bakeAvatarMotion,
  DEFAULT_EAR_MOTION,
  getSpringChains,
  parseEarMotion,
} from "../../src/engine/avatar/springBones";
import { makeAssetMetadata, readAssetMetadata } from "../../src/engine/gltf/assetMetadata";
import type { GLTFRoot } from "../../src/engine/gltf/GLTF";

const args = process.argv.slice(2).filter((a) => a !== "--");
const positional: string[] = [];
const flags = new Map<string, string | true>();
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith("--")) positional.push(a);
  else if (["--avatar", "--no-ear-motion"].includes(a)) flags.set(a, true);
  else flags.set(a, args[++i] ?? "");
}
const [src, dst] = positional;
if (!src || !dst) {
  console.error(
    "usage: bake-gltf.ts in.glb out.glb [--avatar] [--no-ear-motion] [--name …] [--description …|--description-file f] [--author …] [--source url] [--version …]"
  );
  process.exit(2);
}

const buf = readFileSync(src);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a .glb file");
const jsonLength = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8")) as GLTFRoot & {
  extensions?: Record<string, unknown>;
  extensionsUsed?: string[];
};
const rest = buf.subarray(20 + jsonLength);
const used = new Set(gltf.extensionsUsed ?? []);
gltf.extensions ??= {};

if (flags.has("--avatar")) {
  const mapping = getHumanoidMapping(gltf);
  if (!mapping) throw new Error("no humanoid skeleton found: is this an avatar?");
  const chains = getSpringChains(gltf, mapping);
  const ear = flags.has("--no-ear-motion") ? false : parseEarMotion(gltf) || DEFAULT_EAR_MOTION;
  gltf.extensions.HAVEN_avatar_motion = bakeAvatarMotion(chains, ear);
  used.add("HAVEN_avatar_motion");
  const kinds = new Map<string, number>();
  for (const c of chains) kinds.set(c.kind ?? "spring", (kinds.get(c.kind ?? "spring") ?? 0) + 1);
  console.log(
    `springs: ${Array.from(kinds).map(([k, n]) => `${n} ${k}`).join(", ") || "none"}; ear motion ${ear ? "on" : "off"}`
  );
}

const given = {
  name: flags.get("--name"),
  description: flags.has("--description-file")
    ? readFileSync(String(flags.get("--description-file")), "utf8")
    : flags.get("--description"),
  author: flags.get("--author"),
  sourceUrl: flags.get("--source"),
  version: flags.get("--version"),
};
if (Object.values(given).some((v) => typeof v === "string")) {
  const current = (gltf.extensions.HAVEN_metadata ?? {}) as Record<string, string>;
  const next = makeAssetMetadata({
    ...current,
    ...Object.fromEntries(Object.entries(given).filter(([, v]) => typeof v === "string")),
  });
  gltf.extensions.HAVEN_metadata = next;
  used.add("HAVEN_metadata");
  console.log("metadata:", JSON.stringify(readAssetMetadata(gltf)));
}

gltf.extensionsUsed = Array.from(used);
let json = Buffer.from(JSON.stringify(gltf), "utf8");
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + json.length + rest.length, 8);
header.writeUInt32LE(json.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
writeFileSync(dst, Buffer.concat([header, json, rest]));
console.log(`wrote ${dst}`);
