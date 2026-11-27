import { getLimitOverrides } from "../../engine/player/movement.game";
import { ourPlayerQuery } from "../../engine/player/Player";
import { GameContext } from "../../engine/GameTypes";
import { ActionMap, ActionDefinition, ActionType, BindingType, ButtonActionState } from "../../engine/input/ActionMap";
import { GameInputModule, InputModule } from "../../engine/input/input.game";
import { XRAvatarRig } from "../../engine/input/WebXRAvatarRigSystem";
import { getModule, Thread } from "../../engine/module/module.common";
import { getCamera } from "../../engine/player/getCamera";
import { RemoteNode } from "../../engine/resource/RemoteResources";
import { tryGetRemoteResource } from "../../engine/resource/resource.game";
import { ScriptComponent, scriptQuery } from "../../engine/scripting/scripting.game";
import { customItemReady, spawnPrefab } from "../spawnables/spawnables.game";
import { isCustomItemId } from "../../engine/network/spawnRules.common";
import { getSpawnRules, isSpawnAllowed } from "../../engine/network/spawnRules.game";
import {
  ActionBarItem,
  CustomItemInfo,
  DEFAULT_ITEM_KEYS,
  SetActionBarItemsMessage,
  ITEM_KEY_COUNT,
  isItemCloneId,
  ItemClone,
  ItemKeys,
  ThirdRoomMessageType,
} from "./thirdroom.common";
import { ItemVariables } from "../spawnables/itemVariables.common";
import { ThirdRoomModule } from "./thirdroom.game";

export const actionBarMap: ActionMap = {
  id: "action-bar",
  actionDefs: [],
};

for (let i = 0; i < 10; i++) {
  const actionDef: ActionDefinition = {
    id: `action-bar-${i}`,
    path: `ActionBar/${i}`,
    type: ActionType.Button,
    bindings: [
      {
        type: BindingType.Button,
        path: `Keyboard/Digit${i}`,
      },
    ],
  };

  if (i === 1) {
    actionDef.bindings.push({
      type: BindingType.Button,
      path: `XRInputSource/primary/a-button`,
    });
  }

  actionBarMap.actionDefs.push(actionDef);
}

export const defaultActionBarItems: ActionBarItem[] = [
  {
    id: "small-crate",
    label: "Small Crate",
    thumbnail: "/image/small-crate-icon.png",
    spawnable: true,
  },
  {
    id: "medium-crate",
    label: "Medium Crate",
    thumbnail: "/image/medium-crate-icon.png",
    spawnable: true,
  },
  {
    id: "large-crate",
    label: "Large Crate",
    thumbnail: "/image/large-crate-icon.png",
    spawnable: true,
  },
  {
    id: "mirror-ball",
    label: "Mirror Ball",
    thumbnail: "/image/mirror-ball-icon.png",
    spawnable: true,
  },
  {
    id: "black-mirror-ball",
    label: "Black Mirror Ball",
    thumbnail: "/image/black-mirror-ball-icon.png",
    spawnable: true,
  },
  {
    id: "emissive-ball",
    label: "Emissive Ball",
    thumbnail: "/image/emissive-ball-icon.png",
    spawnable: true,
  },
  {
    id: "trampoline",
    label: "Trampoline",
    thumbnail: "/image/trampoline-icon.png",
    spawnable: true,
  },
];

/** Buzzar: which stock Item is on which number key (the Items screen sets this; see ItemKeys). */
let itemKeys: ItemKeys = DEFAULT_ITEM_KEYS;

/** Buzzar: your cloned Items, by id. */
const itemClones = new Map<string, ItemClone>();

/** Buzzar: your own Items' names and pictures, by mxc (a custom Item not listed here still spawns, as "Item"). */
const customItems = new Map<string, CustomItemInfo>();

export function setCustomItems(ctx: GameContext, items: CustomItemInfo[]) {
  const { actionBarItems } = getModule(ctx, ThirdRoomModule);
  const stock = isStockBar(actionBarItems);
  customItems.clear();
  for (const item of items) if (isCustomItemId(item.id)) customItems.set(item.id, item);
  if (stock) setDefaultActionBarItems(ctx);
}

/** Buzzar: what an Item id spawns: a stock prefab, with a clone's variables and name, or a custom Item's file. */
function resolveItem(id: string): { item: ActionBarItem; prefab: string; variables?: ItemVariables } | undefined {
  if (isCustomItemId(id)) {
    const info = customItems.get(id);
    return {
      item: { id, label: info?.name || "Item", thumbnail: info?.thumbnail ?? "", spawnable: true },
      prefab: id,
    };
  }
  const clone = isItemCloneId(id) ? itemClones.get(id) : undefined;
  const base = defaultActionBarItems.find((d) => d.id === (clone ? clone.base : id));
  if (!base) return undefined;
  if (!clone) return { item: base, prefab: base.id };
  return { item: { ...base, id: clone.id, label: clone.name }, prefab: base.id, variables: clone.variables };
}

/** Whether the bar shows the user's Items (stock or cloned) rather than a world script's own items. */
const isStockBar = (items: ActionBarItem[]) => items.every((item) => !!resolveItem(item.id));

/** Buzzar: puts the user's Items on their keys, and refreshes the bar if it's the stock one (not a script's). */
export function setItemKeys(ctx: GameContext, keys: ItemKeys) {
  const { actionBarItems } = getModule(ctx, ThirdRoomModule);
  const stock = isStockBar(actionBarItems);
  itemKeys = Array.from({ length: ITEM_KEY_COUNT }, (_, i) => (typeof keys[i] === "string" ? keys[i] : null));
  if (stock) setDefaultActionBarItems(ctx);
}

/** Buzzar: your cloned Items (from the Items screen); refreshes the bar like setItemKeys. */
export function setItemClones(ctx: GameContext, clones: ItemClone[]) {
  const { actionBarItems } = getModule(ctx, ThirdRoomModule);
  const stock = isStockBar(actionBarItems);
  itemClones.clear();
  for (const clone of clones) if (isItemCloneId(clone.id)) itemClones.set(clone.id, clone);
  if (stock) setDefaultActionBarItems(ctx);
}

/** Buzzar: Items asked for from the Items screen, spawned on the next frame like a number-key press. */
const pendingItemSpawns: string[] = [];

export function queueItemSpawn(id: string) {
  if (resolveItem(id)) pendingItemSpawns.push(id);
}

function spawnItem(ctx: GameContext, from: RemoteNode, id: string, isXR: boolean) {
  const item = resolveItem(id);
  if (!item) return;
  // A custom Item spawns once its file has loaded (so it has its own shape from the start).
  if (isCustomItemId(id)) {
    const ready = customItemReady(ctx, id, () => pendingItemSpawns.push(id));
    if (ready !== "ready") return;
  }
  return spawnPrefab(ctx, from, item.prefab, isXR, item.variables);
}

export function setDefaultActionBarItems(ctx: GameContext) {
  const thirdroom = getModule(ctx, ThirdRoomModule);

  thirdroom.actionBarItems.length = 0;
  // Buzzar: the Items on your number keys, leaving out ones this world doesn't allow.
  const rules = getSpawnRules(ctx);
  // "Ignore world limits for my actions" (Developer settings) shows them all.
  const allowed = (id: string) => getLimitOverrides(ctx).ignoreOwn || isSpawnAllowed(rules, id);
  itemKeys.forEach((id, slot) => {
    const item = id ? resolveItem(id) : undefined;
    if (item && allowed(item.prefab)) thirdroom.actionBarItems.push({ ...item.item, slot });
  });

  ctx.sendMessage<SetActionBarItemsMessage>(Thread.Main, {
    type: ThirdRoomMessageType.SetActionBarItems,
    actionBarItems: thirdroom.actionBarItems,
    allowedItems: [...defaultActionBarItems.map((d) => d.id), ...customItems.keys()].filter(allowed),
  });
}

export function ActionBarSystem(ctx: GameContext) {
  const input = getModule(ctx, InputModule);
  const { actionBarItems } = getModule(ctx, ThirdRoomModule);

  const scripts = scriptQuery(ctx.world);

  processPressedActionBarActions(actionBarItems, input, (actionBarItem) => {
    for (let i = 0; i < scripts.length; i++) {
      const script = ScriptComponent.get(scripts[i]);

      if (!script) {
        continue;
      }
      const actionBarListeners = script.wasmCtx.resourceManager.actionBarListeners;

      for (let l = 0; l < actionBarListeners.length; l++) {
        const listener = actionBarListeners[l];
        listener.actions.push(actionBarItem.id);
      }
    }
  });

  const eid = ourPlayerQuery(ctx.world)[0];
  const queued = pendingItemSpawns.splice(0);

  if (eid) {
    const node = tryGetRemoteResource<RemoteNode>(ctx, eid);
    const xr = XRAvatarRig.get(eid);

    // Buzzar: from the Items screen (the overlay is open, so it's never XR).
    const camera = getCamera(ctx, node).parent;
    for (const id of queued) if (camera && spawnItem(ctx, camera, id, false) === false) break;

    processPressedActionBarActions(actionBarItems, input, (actionBarItem) => {
      if (actionBarItem.spawnable !== true) {
        return;
      }

      if (xr && xr.rightRayEid) {
        const rightRayNode = tryGetRemoteResource<RemoteNode>(ctx, xr.rightRayEid);
        return spawnItem(ctx, rightRayNode, actionBarItem.id, true);
      } else {
        const camera = getCamera(ctx, node).parent;

        if (camera) {
          return spawnItem(ctx, camera, actionBarItem.id, true);
        }
      }
    });
  }
}

function processPressedActionBarActions(
  actionBarItems: ActionBarItem[],
  input: GameInputModule,
  callback: (item: ActionBarItem) => boolean | void
) {
  for (let i = 0; i < actionBarMap.actionDefs.length; i++) {
    const actionDef = actionBarMap.actionDefs[i];
    const action = input.actionStates.get(actionDef.path) as ButtonActionState | undefined;

    if (action?.pressed) {
      const itemIndex = i === 0 ? 9 : i - 1;
      // Buzzar: the stock bar puts Items on chosen keys (slot); a script's bar fills keys 1, 2… in order.
      const actionBarItem = actionBarItems.some((item) => item.slot !== undefined)
        ? actionBarItems.find((item) => item.slot === itemIndex)
        : actionBarItems[itemIndex];

      if (!actionBarItem) {
        continue;
      }

      // Early out if the callback returns false
      // spawnPrefab returns false if the prefab cannot be spawned due to object cap.
      if (callback(actionBarItem) === false) {
        return;
      }
    }
  }
}
