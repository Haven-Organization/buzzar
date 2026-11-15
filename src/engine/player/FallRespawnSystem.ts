import { hasComponent } from "bitecs";
import { mat4 } from "gl-matrix";

import { getSpawnPoints } from "../../plugins/thirdroom/thirdroom.game";
import { GameContext } from "../GameTypes";
import { RemoteNode } from "../resource/RemoteResources";
import { getRemoteResource } from "../resource/resource.game";
import { spawnEntity } from "../utils/spawnEntity";
import { KinematicControls } from "./KinematicCharacterController";
import { ourPlayerQuery } from "./Player";

/** How far below the lowest spawn point a walking player may fall before being respawned. */
const FALL_LIMIT = 25;

const _p = new Float32Array(3);

/**
 * Buzzar: a death plane for every world. Falling well below the world (walking off an edge, or switching fly
 * mode off outside the walls) puts you back at a spawn point instead of falling forever. Flying is exempt.
 */
export function FallRespawnSystem(ctx: GameContext) {
  const eid = ourPlayerQuery(ctx.world)[0];
  if (!eid || !hasComponent(ctx.world, KinematicControls, eid)) return;

  const player = getRemoteResource<RemoteNode>(ctx, eid);
  if (!player) return;

  const spawnPoints = getSpawnPoints(ctx);
  if (spawnPoints.length === 0) return;

  let lowest = Infinity;
  for (const spawnPoint of spawnPoints) lowest = Math.min(lowest, mat4.getTranslation(_p, spawnPoint.worldMatrix)[1]);

  if (player.position[1] < lowest - FALL_LIMIT) {
    spawnEntity(spawnPoints, player);
  }
}
