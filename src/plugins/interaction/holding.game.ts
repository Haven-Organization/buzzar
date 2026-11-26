/**
 * Buzzar: starts and ends holding a Thing in your avatar's hands (engine/avatar/holdPose.ts) as you pick up and let
 * go of Things whose files say how they're held (HAVEN_thing hold). Not in VR, where your controllers are your hands.
 */
import { hasComponent } from "bitecs";

import { GameContext } from "../../engine/GameTypes";
import { defineModule } from "../../engine/module/module.common";
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
import { thingHoldOf } from "../spawnables/thingFile";
import { GrabComponent } from "./interaction.game";

export const HoldingModule = defineModule<GameContext, object>({
  name: "holding",
  create() {
    return {};
  },
  init() {
    setHoldResolver((eid) => thingHoldOf(Prefab.get(eid)));
  },
});

export function HoldingSystem(ctx: GameContext) {
  const rigEid = ourPlayerQuery(ctx.world)[0];
  const player = rigEid ? getRemoteResource<RemoteNode>(ctx, rigEid) : undefined;
  const grabbed = rigEid && hasComponent(ctx.world, GrabComponent, rigEid) ? GrabComponent.grabbedEntity[rigEid] : 0;
  const xr = rigEid ? XRAvatarRig.get(rigEid) : undefined;
  const inXR = !!(xr && xr.leftRayEid && xr.rightRayEid);

  if (getLocalHold() && getLocalHold()!.eid !== grabbed) endLocalHold(ctx);
  if (grabbed && !inXR && !getLocalHold() && hasComponent(ctx.world, Owned, grabbed)) {
    const node = getRemoteResource<RemoteNode>(ctx, grabbed);
    const spec = thingHoldOf(Prefab.get(grabbed));
    if (node && spec) beginLocalHold(ctx, node, spec);
  }
  updateLocalHold(ctx, player);
}
