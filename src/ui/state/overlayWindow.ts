import { atom } from "jotai";

export enum OverlayWindow {
  None = "none",
  CreateWorld = "create_world",
  UserProfile = "user_profile",
  WorldSettings = "world_settings",
  /** Buzzar: your worlds and exploring public ones. */
  Worlds = "worlds",
  /** Buzzar: your avatars (stock, bookmarked) and in-world avatars. */
  Avatars = "avatars",
  /** Buzzar: Things: objects to spawn and use with your avatar (stock and bookmarked). */
  Things = "things",
  /** Buzzar: people in the world you're in, and friends. */
  People = "people",
  /** Buzzar: everything about one world, avatar or Thing. */
  Details = "details",
}

/** Buzzar: what a details page shows. URLs are mxc:// or app paths (stock files). */
export type DetailsItem =
  | { kind: "world"; roomId: string; alias?: string; via?: string[] }
  | { kind: "avatar"; name: string; url?: string; previewUrl?: string; credit?: string }
  | { kind: "thing"; name: string; url?: string; previewUrl?: string; description?: string; stockId?: string };

export type WorldsTab = "yours" | "explore";
export type AvatarsTab = "yours" | "world";
export type PeopleTab = "world" | "friends";

export type OverlayWindowValue =
  | { type: OverlayWindow.None }
  /** Buzzar: `scene` prefills the world's scene (e.g. a world .glb posted in chat). */
  | { type: OverlayWindow.CreateWorld; scene?: { url: string; previewUrl: string } }
  | { type: OverlayWindow.UserProfile }
  | { type: OverlayWindow.WorldSettings; roomId: string }
  | { type: OverlayWindow.Worlds; tab?: WorldsTab }
  | { type: OverlayWindow.Avatars; tab?: AvatarsTab }
  | { type: OverlayWindow.Things }
  | { type: OverlayWindow.People; tab?: PeopleTab }
  /** Buzzar: `back` is the window to return to. */
  | { type: OverlayWindow.Details; item: DetailsItem; back?: OverlayWindowValue };

// Buzzar: open on the Worlds screen (it used to open on the sidebar's world list).
export const overlayWindowAtom = atom<OverlayWindowValue>({ type: OverlayWindow.Worlds });
