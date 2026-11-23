/**
 * Buzzar (Third Room #295): holds other players to the world's speed limit on this client (movement.common.ts).
 *
 * A modified client can move its player as fast as it likes on its own screen; this decides what everyone else sees.
 * Each remote player is shown where they say they are, except that across the ground they never move faster than
 * the world allows (with some slack). Someone going faster falls behind on our screen and catches up when they slow
 * down, and if they keep it up, moderators hear about it (like spawn-rule violations).
 *
 * - Only horizontal movement counts: falling, trampolines and jumping are up and down.
 * - The speed is measured on the playback timeline (positions are already smoothed over network jitter), so a burst
 *   of late packets doesn't look like speeding.
 * - Instant moves the world causes are allowed: landing near a spawn point (respawning) or a seat (sitting down).
 * - "Don't enforce world limits on others for me" (Developer settings) turns this off on this client.
 */
import { vec3 } from "gl-matrix";

import { GameContext } from "../GameTypes";
import { getModule } from "../module/module.common";
import { allowedSpeed } from "../player/movement.common";
import { getLimitOverrides, getMovementRules } from "../player/movement.game";
import { getRemoteResource } from "../resource/resource.game";
import { RemoteNode } from "../resource/RemoteResources";
import { spawnPointQuery } from "../../plugins/thirdroom/thirdroom.game";
import { SeatModule } from "../../plugins/seats/seats.game";
import { reportViolation } from "./spawnRules.game";

/** Allowed speed × this, plus SLACK m/s: room for rounding, slopes and the odd uneven frame. */
const TOLERANCE = 1.25;
const SLACK = 1;
/** A jump this far in one go is a teleport: allowed only onto a spawn point or a seat. */
const TELEPORT_DISTANCE = 6;
const TELEPORT_TARGET_RADIUS = 2.5;
/** Report someone who stays this many metres behind where they claim to be for this many seconds. */
const REPORT_BEHIND = 4;
const REPORT_AFTER = 2;

interface Governed {
  x: number;
  z: number;
  /** Seconds they've been more than REPORT_BEHIND metres ahead of what we show. */
  behindFor: number;
}

const governed = new Map<number, Governed>();

function nearWorldTeleportTarget(ctx: GameContext, x: number, y: number, z: number) {
  const close = (node: RemoteNode | undefined) => {
    if (!node) return false;
    const m = node.worldMatrix;
    return Math.hypot(m[12] - x, m[13] - y, m[14] - z) <= TELEPORT_TARGET_RADIUS;
  };
  for (const eid of spawnPointQuery(ctx.world)) if (close(getRemoteResource<RemoteNode>(ctx, eid))) return true;
  for (const seat of getModule(ctx, SeatModule).seats.values()) if (close(seat.node)) return true;
  return false;
}

/**
 * Where to show remote player `eid` (peer `peerId`) this frame, given where they say they are (`position`, changed
 * in place). Called by the network interpolation for remote players.
 */
export function checkRemotePlayerMove(ctx: GameContext, eid: number, peerId: string, position: vec3) {
  const state = governed.get(eid);
  if (!state || getLimitOverrides(ctx).ignoreOthers) {
    governed.set(eid, { x: position[0], z: position[2], behindFor: 0 });
    return;
  }

  const dx = position[0] - state.x;
  const dz = position[2] - state.z;
  const distance = Math.hypot(dx, dz);
  const step = (allowedSpeed(getMovementRules(ctx)) * TOLERANCE + SLACK) * ctx.dt;

  if (distance <= step) {
    state.x = position[0];
    state.z = position[2];
    state.behindFor = 0;
    return;
  }

  if (distance >= TELEPORT_DISTANCE && nearWorldTeleportTarget(ctx, position[0], position[1], position[2])) {
    state.x = position[0];
    state.z = position[2];
    state.behindFor = 0;
    return;
  }

  // Too fast: show them only as far as the world's speed allows.
  state.x += (dx / distance) * step;
  state.z += (dz / distance) * step;
  position[0] = state.x;
  position[2] = state.z;

  const behind = distance - step;
  state.behindFor = behind > REPORT_BEHIND ? state.behindFor + ctx.dt : 0;
  if (state.behindFor > REPORT_AFTER) {
    reportViolation(ctx, peerId, "moved faster than this world allows");
    state.behindFor = 0;
  }
}

/** Forget a player who left (their entity went away). */
export function forgetRemotePlayer(eid: number) {
  governed.delete(eid);
}
