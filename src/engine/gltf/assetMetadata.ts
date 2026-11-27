/**
 * Buzzar: what an avatar, Item or world file says about itself: `HAVEN_metadata` (docs/gltf/HAVEN_metadata), falling
 * back to VRM's own meta and to the `asset.extras` that Sketchfab and other exporters write (title, author, source).
 */
export interface AssetMetadata {
  name?: string;
  /** Can span several lines (keep its line breaks when showing it). */
  description?: string;
  author?: string;
  sourceUrl?: string;
  version?: string;
  /** An Item's controls while you hold it, shown when you pick it up. */
  controls?: ItemControl[];
}

/**
 * The inputs a held Item responds to, by what they do rather than which key: each client shows its own binding
 * (left click / RT for `use`, and so on). `use`: the main action (fire, spray); `secondary`: the second one (pump,
 * reload); `drop`: let go; `throw`; `rotate`: turn it in your hand.
 */
export const ITEM_CONTROL_ACTIONS = ["use", "secondary", "drop", "throw", "rotate"] as const;
export type ItemControlAction = (typeof ITEM_CONTROL_ACTIONS)[number];

export interface ItemControl {
  action: ItemControlAction;
  /** What it does with this Item, e.g. "Spray (hold)". */
  label: string;
}

/** At most this many controls are shown. */
export const MAX_ITEM_CONTROLS = 8;

function readControls(v: unknown): ItemControl[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const controls: ItemControl[] = [];
  for (const entry of v) {
    if (!isRecord(entry)) continue;
    const action = entry.action as ItemControlAction;
    const label = text(entry.label, 80);
    if (!ITEM_CONTROL_ACTIONS.includes(action) || !label) continue;
    controls.push({ action, label });
    if (controls.length >= MAX_ITEM_CONTROLS) break;
  }
  return controls.length > 0 ? controls : undefined;
}

type AnyRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is AnyRecord => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 10000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
/** Only web links: an author's page or the model's listing. */
const link = (v: unknown) => {
  const s = text(v, 2000);
  if (!s) return undefined;
  try {
    const url = new URL(s);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    // Sketchfab writes "Name (https://…)": take the link out of it.
    const m = s.match(/https?:\/\/[^\s)]+/);
    return m ? m[0] : undefined;
  }
};

export function readAssetMetadata(gltf: { asset?: unknown; extensions?: unknown }): AssetMetadata {
  const ext = isRecord(gltf.extensions) ? gltf.extensions : {};
  const own = isRecord(ext.HAVEN_metadata) ? ext.HAVEN_metadata : {};
  const vrm1 = isRecord(ext.VRMC_vrm) && isRecord(ext.VRMC_vrm.meta) ? ext.VRMC_vrm.meta : {};
  const vrm0 = isRecord(ext.VRM) && isRecord(ext.VRM.meta) ? ext.VRM.meta : {};
  const extras = isRecord(gltf.asset) && isRecord(gltf.asset.extras) ? gltf.asset.extras : {};
  const vrm1Authors = Array.isArray(vrm1.authors) ? vrm1.authors.filter((a) => typeof a === "string").join(", ") : "";
  const out: AssetMetadata = {
    name: text(own.name, 200) ?? text(vrm1.name, 200) ?? text(vrm0.title, 200) ?? text(extras.title, 200),
    description: text(own.description),
    author:
      text(own.author, 500) ??
      text(vrm1Authors, 500) ??
      text(vrm0.author, 500) ??
      text(extras.author, 500)?.replace(/\s*\(https?:\/\/[^)]*\)\s*$/, ""),
    sourceUrl: link(own.sourceUrl) ?? link(vrm0.reference) ?? link(extras.source),
    version: text(own.version, 100) ?? text(vrm1.version, 100) ?? text(vrm0.version, 100),
    controls: readControls(own.controls),
  };
  for (const key of Object.keys(out) as (keyof AssetMetadata)[]) if (out[key] === undefined) delete out[key];
  return out;
}

/** `HAVEN_metadata` for a file (only the fields given). */
export function makeAssetMetadata(meta: AssetMetadata): AssetMetadata {
  const out: AssetMetadata = {};
  for (const key of ["name", "description", "author", "sourceUrl", "version"] as const) {
    const value = meta[key]?.trim();
    if (value) out[key] = value;
  }
  // Kept as they are when other details are saved into the file.
  if (meta.controls?.length) out.controls = meta.controls;
  return out;
}
