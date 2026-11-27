/**
 * Buzzar: starts and ends holding an Item in your avatar's hands (engine/avatar/holdPose.ts) as you pick up and let
 * go of Items whose files say how they're held (HAVEN_item hold). Not in VR, where your controllers are your hands.
 */
import { hasComponent } from "bitecs";

import { GameContext } from "../../engine/GameTypes";
import { defineModule, Thread } from "../../engine/module/module.common";
import { Owned } from "../../engine/network/NetworkComponents";
import { Prefab } from "../../engine/prefab/prefab.game";
import { ourPlayerQuery } from "../../engine/player/Player";
import { XRAvatarRig } from "../../engine/input/WebXRAvatarRigSystem";
import { RemoteNode } from "../../engine/resource/RemoteResources";
import { getRemoteResource } from "../../engine/resource/resource.game";
import {
  beginLocalHold,
  endLocalHold,
  getLocalHold,
  setHoldResolver,
  updateLocalHold,
} from "../../engine/avatar/holdPose";
import { loadedItemFile, itemHoldOf } from "../spawnables/itemFile";
import { readAssetMetadata } from "../../engine/gltf/assetMetadata";
import { isCustomItemId } from "../../engine/network/spawnRules.common";
import { ItemEquippedMessage, ThirdRoomMessageType } from "../thirdroom/thirdroom.common";
import { GrabComponent } from "./interaction.game";

export const HoldingModule = defineModule<GameContext, object>({
  name: "holding",
  create() {
    return {};
  },
  init() {
    setHoldResolver((eid) => itemHoldOf(Prefab.get(eid)));
  },
});

/** What we held last frame, to notice picking something up. */
let lastHeld = 0;

/** Shows an Item's controls (HAVEN_metadata controls) when you pick it up, if its file lists them. */
function announceControls(ctx: GameContext, eid: number) {
  const prefab = Prefab.get(eid);
  const file = prefab && isCustomItemId(prefab) ? loadedItemFile(prefab) : undefined;
  const meta = file ? readAssetMetadata(file as never) : undefined;
  if (!meta?.controls) return;
  ctx.sendMessage<ItemEquippedMessage>(Thread.Main, {
    type: ThirdRoomMessageType.ItemEquipped,
    name: meta.name ?? "Item",
    controls: meta.controls,
  });
}

export function HoldingSystem(ctx: GameContext) {
  const rigEid = ourPlayerQuery(ctx.world)[0];
  const player = rigEid ? getRemoteResource<RemoteNode>(ctx, rigEid) : undefined;
  const grabbed = rigEid && hasComponent(ctx.world, GrabComponent, rigEid) ? GrabComponent.grabbedEntity[rigEid] : 0;
  const xr = rigEid ? XRAvatarRig.get(rigEid) : undefined;
  const inXR = !!(xr && xr.leftRayEid && xr.rightRayEid);

  if (grabbed !== lastHeld) {
    lastHeld = grabbed;
    if (grabbed && hasComponent(ctx.world, Owned, grabbed)) announceControls(ctx, grabbed);
  }

  if (getLocalHold() && getLocalHold()!.eid !== grabbed) endLocalHold(ctx);
  if (grabbed && !inXR && !getLocalHold() && hasComponent(ctx.world, Owned, grabbed)) {
    const node = getRemoteResource<RemoteNode>(ctx, grabbed);
    const spec = itemHoldOf(Prefab.get(grabbed));
    if (node && spec) beginLocalHold(ctx, node, spec);
  }
  updateLocalHold(ctx, player);
}
