/**
 * Buzzar: reading and writing a .glb's own details (HAVEN_metadata: name, description, author, source, version) in
 * the browser, for the upload screens: they show what a file says about itself, and can save what you type back
 * into the file before it's uploaded. Only the file's JSON changes; its binary data is copied unchanged.
 */
import { AssetMetadata, makeAssetMetadata, readAssetMetadata } from "../../engine/gltf/assetMetadata";

const GLB_MAGIC = 0x46546c67;

/** A Blob's bytes (FileReader where Blob.arrayBuffer is missing, as in some test environments). */
function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
const JSON_CHUNK = 0x4e4f534a;

/** The glTF JSON of a .glb (undefined if it isn't one). Reads only the JSON chunk's bytes. */
export async function readGlbJson(blob: Blob): Promise<Record<string, unknown> | undefined> {
  const head = new DataView(await bytesOf(blob.slice(0, 20)));
  if (head.byteLength < 20 || head.getUint32(0, true) !== GLB_MAGIC || head.getUint32(16, true) !== JSON_CHUNK) {
    return undefined;
  }
  const length = head.getUint32(12, true);
  const text = new TextDecoder().decode(await bytesOf(blob.slice(20, 20 + length)));
  return JSON.parse(text) as Record<string, unknown>;
}

/** What a .glb says about itself (empty if it says nothing or isn't a .glb). */
export async function readFileMetadata(blob: Blob): Promise<AssetMetadata> {
  try {
    const json = await readGlbJson(blob);
    return json ? readAssetMetadata(json) : {};
  } catch {
    return {};
  }
}

/** Fields typed on an upload screen that would be written into the file. */
export type EditableMetadata = Pick<AssetMetadata, "description" | "version">;

const clean = (v?: string) => v?.replace(/\r\n/g, "\n").trim() || undefined;

/** Whether what was typed differs from what the file says (empty fields never count as a change). */
export function metadataDiffers(file: AssetMetadata, typed: EditableMetadata): boolean {
  return (["description", "version"] as const).some((k) => {
    const value = clean(typed[k]);
    return value !== undefined && value !== clean(file[k]);
  });
}

/**
 * A copy of the .glb with `typed` written into its HAVEN_metadata (fields left empty keep the file's own). The binary
 * chunk is copied byte for byte.
 */
export async function bakeFileMetadata(blob: Blob, typed: EditableMetadata): Promise<Blob> {
  const buffer = await bytesOf(blob);
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(16, true) !== JSON_CHUNK) {
    throw new Error("Only .glb and .vrm files can carry details");
  }
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))) as Record<string, any>;
  const rest = new Uint8Array(buffer, 20 + jsonLength);

  json.extensions ??= {};
  const current = (json.extensions.HAVEN_metadata ?? {}) as AssetMetadata;
  json.extensions.HAVEN_metadata = makeAssetMetadata({
    ...current,
    ...(clean(typed.description) ? { description: clean(typed.description) } : {}),
    ...(clean(typed.version) ? { version: clean(typed.version) } : {}),
  });
  const used = new Set<string>(Array.isArray(json.extensionsUsed) ? json.extensionsUsed : []);
  used.add("HAVEN_metadata");
  json.extensionsUsed = Array.from(used);

  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  if (pad) {
    const padded = new Uint8Array(jsonBytes.length + pad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const out = new Uint8Array(20 + jsonBytes.length + rest.length);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, GLB_MAGIC, true);
  outView.setUint32(4, 2, true);
  outView.setUint32(8, out.length, true);
  outView.setUint32(12, jsonBytes.length, true);
  outView.setUint32(16, JSON_CHUNK, true);
  out.set(jsonBytes, 20);
  out.set(rest, 20 + jsonBytes.length);
  return new Blob([out], { type: blob.type || "model/gltf-binary" });
}
