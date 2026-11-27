import type { ItemVariables } from "../spawnables/itemVariables.common";
import type { ItemControl } from "../../engine/gltf/assetMetadata";

export enum ThirdRoomMessageType {
  EnterWorld = "enter-world",
  EnteredWorld = "entered-world",
  EnterWorldError = "enter-world-error",
  ExitWorld = "exit-world",
  ExitedWorld = "exited-world",
  LoadWorld = "load-world",
  WorldLoaded = "world-loaded",
  WorldLoadError = "world-load-error",
  PrintThreadState = "print-thread-state",
  PrintResources = "print-resources",
  ReticleFocus = "reticle-focus",
  FindResourceRetainers = "find-resource-retainers",
  SetActionBarItems = "set-action-bar-items",
  SetObjectCap = "set-object-cap",
  ObjectCapReached = "object-cap-reached",
  ReloadWorld = "reload-world",
  ReloadedWorld = "reloaded-world",
  ReloadWorldError = "reload-world-error",
  /** Buzzar: the world script failed to load or crashed; the world carries on without it. */
  ScriptFailed = "script-failed",
  /** Buzzar: spawn a stock Item in front of the player (from the Items screen). */
  SpawnItem = "spawn-item",
  /** Buzzar: your cloned Items (from the Items screen). */
  SetItemClones = "set-item-clones",
  /** Buzzar: which Item is on each number key (from the Items screen). */
  SetItemKeys = "set-item-keys",
  /** Buzzar: your own Items (uploaded or bookmarked files), for their names and pictures on the action bar. */
  SetCustomItems = "set-custom-items",
  /** Buzzar: you just picked up (or spawned into your hold) an Item that lists its controls. */
  ItemEquipped = "item-equipped",
}

/**
 * Buzzar: the Item (a stock Item's prefab id) on each number key, or null: index 0 is key 1, index 8 key 9 and
 * index 9 key 0, left to right along the keyboard.
 */
export type ItemKeys = (string | null)[];
export const ITEM_KEY_COUNT = 10;
export const DEFAULT_ITEM_KEYS: ItemKeys = [
  "small-crate",
  "medium-crate",
  "large-crate",
  "mirror-ball",
  "black-mirror-ball",
  "emissive-ball",
  "trampoline",
  null,
  null,
  null,
];
/** The key printed for a slot (slot 9 is the 0 key). */
export const itemKeyName = (slot: number) => String((slot + 1) % 10);

export interface SetItemKeysMessage {
  type: ThirdRoomMessageType.SetItemKeys;
  keys: ItemKeys;
}

/**
 * Buzzar: a cloned Item: a stock Item (`base`) with its own name and variables (size, colour…; see
 * plugins/spawnables/itemVariables.common.ts). Its id (`clone:…`) can go on a number key like a stock Item's.
 */
export interface ItemClone {
  id: string;
  base: string;
  name: string;
  variables: ItemVariables;
}

export const isItemCloneId = (id: string) => id.startsWith("clone:");

export interface SetItemClonesMessage {
  type: ThirdRoomMessageType.SetItemClones;
  clones: ItemClone[];
}

/** Buzzar: one of your own Items: a .glb file on Matrix, whose id is its mxc:// URI. */
export interface CustomItemInfo {
  id: string;
  name: string;
  /** A loadable picture of it, if it has one. */
  thumbnail?: string;
}

export interface SetCustomItemsMessage {
  type: ThirdRoomMessageType.SetCustomItems;
  items: CustomItemInfo[];
}

export interface SpawnItemMessage {
  type: ThirdRoomMessageType.SpawnItem;
  /** A stock Item's prefab id (an action bar item id, e.g. "small-crate"), a clone's id, or a custom Item's mxc. */
  id: string;
}

export interface ScriptFailedMessage {
  type: ThirdRoomMessageType.ScriptFailed;
  error: string;
}

export interface EnterWorldMessage {
  type: ThirdRoomMessageType.EnterWorld;
  id: number;
  localPeerId?: string;
}

export interface EnteredWorldMessage {
  type: ThirdRoomMessageType.EnteredWorld;
  id: number;
}

export interface EnterWorldErrorMessage {
  type: ThirdRoomMessageType.EnterWorldError;
  id: number;
  error: string;
}

export interface ReloadWorldMessage {
  type: ThirdRoomMessageType.ReloadWorld;
  id: number;
  environmentUrl: string;
  options?: LoadWorldOptions;
}

export interface ReloadedWorldMessage {
  type: ThirdRoomMessageType.ReloadedWorld;
  id: number;
}

export interface ReloadWorldErrorMessage {
  type: ThirdRoomMessageType.ReloadWorldError;
  id: number;
  error: string;
}

export interface ExitWorldMessage {
  type: ThirdRoomMessageType.ExitWorld;
}

export interface ExitedWorldMessage {
  type: ThirdRoomMessageType.ExitedWorld;
}

export interface LoadWorldOptions {
  environmentScriptUrl?: string;
  maxObjectCap?: number;
  fileMap?: Map<string, string>;
}

export interface LoadWorldMessage {
  type: ThirdRoomMessageType.LoadWorld;
  id: number;
  environmentUrl: string;
  options?: LoadWorldOptions;
}

export interface WorldLoadedMessage {
  type: ThirdRoomMessageType.WorldLoaded;
  id: number;
  url: string;
}

export interface WorldLoadErrorMessage {
  type: ThirdRoomMessageType.WorldLoadError;
  id: number;
  url: string;
  error: string;
}

export interface PrintThreadStateMessage {
  type: ThirdRoomMessageType.PrintThreadState;
}

export interface PrintResourcesMessage {
  type: ThirdRoomMessageType.PrintResources;
}

export interface FindResourceRetainersMessage {
  type: ThirdRoomMessageType.FindResourceRetainers;
  resourceId: number;
}

export interface ActionBarItem {
  id: string;
  label: string;
  thumbnail: string;
  spawnable?: boolean;
  /** Buzzar: the slot (see ItemKeys) it's on; items without one (a world script's bar) go on keys 1, 2… in order. */
  slot?: number;
}

export interface SetActionBarItemsMessage {
  type: ThirdRoomMessageType.SetActionBarItems;
  actionBarItems: ActionBarItem[];
  /** Buzzar: the stock and custom Items this world's rules allow (clones go by their base). */
  allowedItems?: string[];
}

export interface ObjectCapReachedMessage {
  type: ThirdRoomMessageType.ObjectCapReached;
}
export interface SetObjectCapMessage {
  type: ThirdRoomMessageType.SetObjectCap;
  value: number;
}

/** Buzzar: game → main: an Item's name and controls (HAVEN_metadata controls), shown for a few seconds. */
export interface ItemEquippedMessage {
  type: ThirdRoomMessageType.ItemEquipped;
  name: string;
  controls: ItemControl[];
}
