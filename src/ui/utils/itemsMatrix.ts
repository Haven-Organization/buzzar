/**
 * Buzzar: Items: objects you can spawn into worlds and use with your avatar (crates, balls…). The stock ones ship
 * with Buzzar; Items you bookmark (e.g. a .glb someone posted in chat) are kept in account data,
 * software.haven.world.things, so they follow you between devices.
 */
import { MatrixAuth } from "./avatarMatrix";
import { getAccountData } from "./legacyAccountData";

export const ITEMS_COLLECTION_TYPE = "software.haven.world.items";
const MAX_SAVED_ITEMS = 200;
const MXC_REGEX = /^mxc:\/\/[A-Za-z0-9.\-:[\]]+\/[A-Za-z0-9_-]+$/;

export interface ItemContent {
  /** mxc:// of the .glb. */
  url: string;
  name?: string;
  preview_url?: string;
}

export interface SavedItem extends ItemContent {
  /** When it was added, in ms since the epoch. */
  added_ts: number;
}

export interface ItemCollection {
  /** Newest first. */
  items: SavedItem[];
}

/** A stock Item: one Buzzar ships (its id is the spawn prefab's), which you can put on a number key. */
export interface StockItem {
  id: string;
  name: string;
  preview: string;
  description: string;
  /** Buzzar: set for one of your own Items (an uploaded or bookmarked file; its id is the file's mxc). */
  custom?: SavedItem;
}

export const STOCK_ITEMS: StockItem[] = [
  { id: "small-crate", name: "Small Crate", preview: "/image/items/crate.png", description: "1 m crate" },
  { id: "medium-crate", name: "Medium Crate", preview: "/image/items/crate.png", description: "1.75 m crate" },
  { id: "large-crate", name: "Large Crate", preview: "/image/items/crate.png", description: "2.5 m crate" },
  { id: "mirror-ball", name: "Mirror Ball", preview: "/image/items/mirror-ball.png", description: "1 m chrome ball" },
  {
    id: "black-mirror-ball",
    name: "Black Mirror Ball",
    preview: "/image/items/black-mirror-ball.png",
    description: "1 m black chrome ball",
  },
  {
    id: "emissive-ball",
    name: "Emissive Ball",
    preview: "/image/items/emissive-ball.png",
    description: "2 m glowing ball",
  },
  {
    id: "trampoline",
    name: "Trampoline",
    preview: "/image/items/trampoline.png",
    description: "3 m trampoline: land on it to bounce, hold jump to go higher, crouch to stop",
  },
];

/** Validates untrusted account data. */
export function parseItemCollection(value: unknown): ItemCollection {
  const collection: ItemCollection = { items: [] };
  if (typeof value !== "object" || value === null) return collection;
  // `things`: saved before Things became Items.
  const list = (value as Record<string, unknown>).items ?? (value as Record<string, unknown>).things;
  if (!Array.isArray(list)) return collection;
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.url !== "string" || !MXC_REGEX.test(r.url)) continue;
    if (collection.items.some((t) => t.url === r.url)) continue;
    const item: SavedItem = { url: r.url, added_ts: typeof r.added_ts === "number" ? r.added_ts : 0 };
    if (typeof r.name === "string" && r.name.trim()) item.name = r.name.trim().slice(0, 200);
    if (typeof r.preview_url === "string" && MXC_REGEX.test(r.preview_url)) item.preview_url = r.preview_url;
    collection.items.push(item);
  }
  return collection;
}

export async function fetchItemCollection(auth: MatrixAuth, userId: string): Promise<ItemCollection> {
  const res = await getAccountData(auth, userId, ITEMS_COLLECTION_TYPE);
  if (res.status === 404) return { items: [] };
  if (!res.ok) throw new Error(`Couldn't load your Items: ${res.status}`);
  return parseItemCollection(await res.json());
}

async function putItemCollection(auth: MatrixAuth, userId: string, collection: ItemCollection) {
  const base = auth.homeserver.replace(/\/+$/, "");
  const res = await fetch(
    `${base}/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${ITEMS_COLLECTION_TYPE}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(collection),
    }
  );
  if (!res.ok) throw new Error(`Couldn't save your Items: ${res.status} ${await res.text()}`);
}

/** Adds (or moves to the front, updating its details) an Item in the user's collection. */
export async function saveToItemCollection(auth: MatrixAuth, userId: string, item: ItemContent) {
  const collection = await fetchItemCollection(auth, userId);
  const existing = collection.items.find((t) => t.url === item.url);
  const saved: SavedItem = { ...existing, ...item, added_ts: existing?.added_ts ?? Date.now() };
  if (!saved.preview_url) delete saved.preview_url;
  collection.items = [saved, ...collection.items.filter((t) => t.url !== item.url)].slice(0, MAX_SAVED_ITEMS);
  await putItemCollection(auth, userId, collection);
  return collection;
}

export async function removeFromItemCollection(auth: MatrixAuth, userId: string, url: string) {
  const collection = await fetchItemCollection(auth, userId);
  collection.items = collection.items.filter((t) => t.url !== url);
  await putItemCollection(auth, userId, collection);
  return collection;
}
