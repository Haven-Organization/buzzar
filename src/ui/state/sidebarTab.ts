import { atom } from "jotai";

import { OverlayWindow, overlayWindowAtom } from "./overlayWindow";

/** Buzzar: sidebar lists (Worlds, Avatars and People are full-screen overlay windows instead). */
export enum SidebarTab {
  Chat = "Chat",
  Notifications = "Notifications",
}

const baseSidebarTabAtom = atom<SidebarTab>(SidebarTab.Chat);

export const sidebarTabAtom = atom<SidebarTab, [SidebarTab], void>(
  (get) => get(baseSidebarTabAtom),
  (get, set, value) => {
    set(overlayWindowAtom, { type: OverlayWindow.None });
    set(baseSidebarTabAtom, value);
  }
);
