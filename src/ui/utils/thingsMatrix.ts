/**
 * Buzzar: Things: objects you can spawn into worlds and use with your avatar (crates, balls…). The stock ones ship
 * with Buzzar; Things you bookmark (e.g. a .glb someone posted in chat) are kept in account data,
 * software.haven.world.things, so they follow you between devices.
 */
import { MatrixAuth } from "./avatarMatrix";
import { getAccountData } from "./legacyAccountData";

export const THINGS_COLLECTION_TYPE = "software.haven.world.things";
const MAX_SAVED_THINGS = 200;
const MXC_REGEX = /^mxc:\/\/[A-Za-z0-9.\-:[\]]+\/[A-Za-z0-9_-]+$/;

export interface ThingContent {
  /** mxc:// of the .glb. */
  url: string;
  name?: string;
  preview_url?: string;
}

export interface SavedThing extends ThingContent {
  /** When it was added, in ms since the epoch. */
  added_ts: number;
}

export interface ThingCollection {
  /** Newest first. */
  things: SavedThing[];
}

/** A stock Thing: one Buzzar ships (its id is the spawn prefab's), which you can put on a number key. */
export interface StockThing {
  id: string;
  name: string;
  preview: string;
  description: string;
}

export const STOCK_THINGS: StockThing[] = [
  { id: "small-crate", name: "Small Crate", preview: "/image/things/crate.png", description: "1 m crate" },
  { id: "medium-crate", name: "Medium Crate", preview: "/image/things/crate.png", description: "1.75 m crate" },
  { id: "large-crate", name: "Large Crate", preview: "/image/things/crate.png", description: "2.5 m crate" },
  { id: "mirror-ball", name: "Mirror Ball", preview: "/image/things/mirror-ball.png", description: "1 m chrome ball" },
  {
    id: "black-mirror-ball",
    name: "Black Mirror Ball",
    preview: "/image/things/black-mirror-ball.png",
    description: "1 m black chrome ball",
  },
  {
    id: "emissive-ball",
    name: "Emissive Ball",
    preview: "/image/things/emissive-ball.png",
    description: "2 m glowing ball",
  },
  {
    id: "trampoline",
    name: "Trampoline",
    preview: "/image/things/trampoline.png",
    description: "3 m trampoline: land on it to bounce, hold jump to go higher, crouch to stop",
  },
];

/** Validates untrusted account data. */
export function parseThingCollection(value: unknown): ThingCollection {
  const collection: ThingCollection = { things: [] };
  if (typeof value !== "object" || value === null) return collection;
  const list = (value as Record<string, unknown>).things;
  if (!Array.isArray(list)) return collection;
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.url !== "string" || !MXC_REGEX.test(r.url)) continue;
    if (collection.things.some((t) => t.url === r.url)) continue;
    const thing: SavedThing = { url: r.url, added_ts: typeof r.added_ts === "number" ? r.added_ts : 0 };
    if (typeof r.name === "string" && r.name.trim()) thing.name = r.name.trim().slice(0, 200);
    if (typeof r.preview_url === "string" && MXC_REGEX.test(r.preview_url)) thing.preview_url = r.preview_url;
    collection.things.push(thing);
  }
  return collection;
}

export async function fetchThingCollection(auth: MatrixAuth, userId: string): Promise<ThingCollection> {
  const res = await getAccountData(auth, userId, THINGS_COLLECTION_TYPE);
  if (res.status === 404) return { things: [] };
  if (!res.ok) throw new Error(`Couldn't load your Things: ${res.status}`);
  return parseThingCollection(await res.json());
}

async function putThingCollection(auth: MatrixAuth, userId: string, collection: ThingCollection) {
  const base = auth.homeserver.replace(/\/+$/, "");
  const res = await fetch(
    `${base}/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${THINGS_COLLECTION_TYPE}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(collection),
    }
  );
  if (!res.ok) throw new Error(`Couldn't save your Things: ${res.status} ${await res.text()}`);
}

/** Adds (or moves to the front, updating its details) a Thing in the user's collection. */
export async function saveToThingCollection(auth: MatrixAuth, userId: string, thing: ThingContent) {
  const collection = await fetchThingCollection(auth, userId);
  const existing = collection.things.find((t) => t.url === thing.url);
  const saved: SavedThing = { ...existing, ...thing, added_ts: existing?.added_ts ?? Date.now() };
  if (!saved.preview_url) delete saved.preview_url;
  collection.things = [saved, ...collection.things.filter((t) => t.url !== thing.url)].slice(0, MAX_SAVED_THINGS);
  await putThingCollection(auth, userId, collection);
  return collection;
}

export async function removeFromThingCollection(auth: MatrixAuth, userId: string, url: string) {
  const collection = await fetchThingCollection(auth, userId);
  collection.things = collection.things.filter((t) => t.url !== url);
  await putThingCollection(auth, userId, collection);
  return collection;
}
