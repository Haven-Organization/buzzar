/**
 * Buzzar: what chat messages can show as tiles (parity checklist §8):
 * - rooms a message links to (#alias:server, a room pill, a matrix.to or matrix: link), shown with a Join button
 *   when the room is a world;
 * - .glb / .vrm files, classified as an avatar, a world or an Item from the file's own description (its glTF JSON),
 *   read without downloading the whole file.
 */
import { getHumanoidMapping } from "../../engine/avatar/humanoid";
import { GLTFRoot } from "../../engine/gltf/GLTF";
import { parseMatrixUri } from "./matrixUtils";

export interface RoomLink {
  /** #alias:server or !roomid(:server). */
  target: string;
  via: string[];
}

const ALIAS = /(^|[\s(>"'])(#[^\s:#"'<>]+:[A-Za-z0-9.-]+(?::\d+)?)/g;
const LINK = /\b(?:https?:\/\/matrix\.to\/#\/[^\s"'<>]+|matrix:(?:r|roomid)\/[^\s"'<>]+)/g;
/** At most this many tiles per message. */
const MAX_LINKS = 3;

/** The rooms a message's text and links point to, in order, without duplicates (people and events are skipped). */
export function extractRoomLinks(content: Record<string, unknown> | undefined): RoomLink[] {
  if (!content) return [];
  const texts = [content.body, content.formatted_body].filter((v): v is string => typeof v === "string");
  const out: RoomLink[] = [];
  const add = (target: string, via: string[] = []) => {
    if (out.length >= MAX_LINKS || out.some((l) => l.target === target)) return;
    out.push({ target, via });
  };
  for (const text of texts) {
    for (const match of text.matchAll(LINK)) {
      try {
        const parsed = parseMatrixUri(match[0].replace(/[.,;:!?)]+$/, ""));
        if (parsed instanceof URL) continue;
        if (!/^[#!]/.test(parsed.mxid1) || parsed.mxid2) continue;
        add(parsed.mxid1, parsed.via);
      } catch {
        // Not a valid Matrix link.
      }
    }
    // Bare aliases (not inside a link we already read).
    const withoutLinks = text.replace(LINK, " ").replace(/href="[^"]*"/g, " ");
    for (const match of withoutLinks.matchAll(ALIAS)) add(match[2].replace(/[.,;:!?)]+$/, ""));
  }
  return out;
}

export type ModelKind = "avatar" | "world" | "item";

/** File names chat tiles treat as 3D models. */
export function isModelFile(name: string | undefined, mimetype?: string) {
  return /\.(glb|vrm)$/i.test(name ?? "") || mimetype === "model/gltf-binary";
}

/** Extensions only worlds use. */
const WORLD_EXTENSIONS = [
  "MX_spawn_point",
  "MX_portal",
  "MX_lightmap",
  "MX_background",
  "MX_reflection_probe",
  "MX_scene_ar",
  "HAVEN_mirror",
  "HAVEN_avatar_pedestal",
  "HAVEN_climbable",
  "HAVEN_grabbable",
  "OMI_spawn_point",
];
/** A model bigger than this (metres across) is a place, not an Item. */
const WORLD_SIZE = 12;

/** Roughly how big a model is (metres across): its meshes' bounds scaled by their nodes, ignoring rotation. */
export function approximateSize(json: GLTFRoot): number {
  const nodes = json.nodes ?? [];
  const parent = new Map<number, number>();
  nodes.forEach((node, i) => node.children?.forEach((c) => parent.set(c, i)));
  const scaleOf = (i: number | undefined): number => {
    let s = 1;
    while (i !== undefined) {
      const n = nodes[i];
      const sc = n.scale ?? (n.matrix ? [Math.hypot(n.matrix[0], n.matrix[1], n.matrix[2])] : [1]);
      s *= Math.max(...sc.map(Math.abs));
      i = parent.get(i);
    }
    return s;
  };
  let biggest = 0;
  nodes.forEach((node, i) => {
    if (node.mesh === undefined) return;
    for (const prim of json.meshes?.[node.mesh]?.primitives ?? []) {
      const acc = json.accessors?.[prim.attributes?.POSITION as number];
      if (!acc?.min || !acc?.max) continue;
      const extent = Math.max(...acc.max.map((v, k) => v - (acc.min as number[])[k]));
      biggest = Math.max(biggest, extent * scaleOf(i));
    }
  });
  return biggest;
}

/** Avatar (VRM, or a humanoid skeleton), world (world features, or big), else an Item. */
export function classifyModel(json: GLTFRoot, fileName?: string): ModelKind {
  if (/\.vrm$/i.test(fileName ?? "")) return "avatar";
  const extensions = new Set([...(json.extensionsUsed ?? []), ...Object.keys(json.extensions ?? {})]);
  if (extensions.has("VRM") || extensions.has("VRMC_vrm")) return "avatar";
  if (WORLD_EXTENSIONS.some((e) => extensions.has(e))) return "world";
  if ((json.skins?.length ?? 0) > 0 && getHumanoidMapping(json)) return "avatar";
  return approximateSize(json) > WORLD_SIZE ? "world" : "item";
}

/** Reads just a .glb's JSON chunk from `url`, streaming and stopping as soon as it has it. */
export async function fetchGlbJson(url: string, signal?: AbortSignal): Promise<GLTFRoot> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Couldn't download the file (${res.status})`);
  const reader = res.body.getReader();
  let buffer = new Uint8Array(0);
  let need = 20;
  try {
    for (;;) {
      while (buffer.length < need) {
        const { value, done } = await reader.read();
        if (done) throw new Error("The file ended early");
        const next = new Uint8Array(buffer.length + value.length);
        next.set(buffer);
        next.set(value, buffer.length);
        buffer = next;
      }
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Not a .glb file");
      const jsonLength = view.getUint32(12, true);
      if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error("No JSON in the .glb");
      if (jsonLength > 64 * 1024 * 1024) throw new Error("The .glb's description is too big");
      need = 20 + jsonLength;
      if (buffer.length >= need) return JSON.parse(new TextDecoder().decode(buffer.subarray(20, need))) as GLTFRoot;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
