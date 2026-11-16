import { atom } from "jotai";

export enum OverlayWindow {
  None = "none",
  CreateWorld = "create_world",
  UserProfile = "user_profile",
  WorldSettings = "world_settings",
  /** Buzzar: your worlds and exploring public ones. */
  Worlds = "worlds",
  /** Buzzar: stock, bookmarked and in-world avatars. */
  Avatars = "avatars",
  /** Buzzar: people in the world you're in, and friends. */
  People = "people",
}

export type WorldsTab = "yours" | "explore";
export type AvatarsTab = "stock" | "bookmarked" | "world";
export type PeopleTab = "world" | "friends";

export type OverlayWindowValue =
  | { type: OverlayWindow.None }
  | { type: OverlayWindow.CreateWorld }
  | { type: OverlayWindow.UserProfile }
  | { type: OverlayWindow.WorldSettings; roomId: string }
  | { type: OverlayWindow.Worlds; tab?: WorldsTab }
  | { type: OverlayWindow.Avatars; tab?: AvatarsTab }
  | { type: OverlayWindow.People; tab?: PeopleTab };

// Buzzar: open on the Worlds screen (it used to open on the sidebar's world list).
export const overlayWindowAtom = atom<OverlayWindowValue>({ type: OverlayWindow.Worlds });
