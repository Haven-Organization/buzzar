/**
 * Buzzar: Things (crates, balls, anything with a dynamic physics body) bounce on trampolines too, when thrown or
 * dropped on them. Runs right after the physics step: a body that was falling and has just been stopped (or slowed
 * hard) with its centre over a trampoline's bouncy area is sent back up (trampolines.ts, objectBounceSpeed).
 *
 * Only bodies this client simulates are dynamic (other clients' objects are kinematic copies), so each object's bounce
 * is worked out once, by its owner, and the network carries it to everyone else.
 */
import RAPIER from "@dimforge/rapier3d-compat";

import { GameContext } from "../GameTypes";
import { getModule } from "../module/module.common";
import { PhysicsModule } from "../physics/physics.game";
import { RemoteNode } from "../resource/RemoteResources";
import { isOnTrampoline, liveTrampolines, objectBounceSpeed, Trampoline } from "./trampolines";

/** Body handle → its vertical speed after the previous step. */
let lastVy = new Map<number, number>();
/** Falling at least this fast (m/s) before the step counts as a landing. */
const MIN_IMPACT_SPEED = 1.5;
const _v = new RAPIER.Vector3(0, 0, 0);

/** The physics body a trampoline belongs to (the stock Thing's own), so it doesn't bounce on itself. */
function ownBody(trampoline: Trampoline): RAPIER.RigidBody | undefined {
  for (let node: RemoteNode | undefined = trampoline.node; node; node = node.parent as RemoteNode | undefined) {
    const body = node.physicsBody?.body;
    if (body) return body;
  }
  return undefined;
}

/** About how far a body's surface reaches from its centre (metres), from its first collider's shape. */
function reach(body: RAPIER.RigidBody): number {
  const shape = body.numColliders() > 0 ? (body.collider(0).shape as unknown as Record<string, unknown>) : undefined;
  if (!shape) return 0.5;
  const radius = typeof shape.radius === "number" ? shape.radius : 0;
  const halfHeight = typeof shape.halfHeight === "number" ? shape.halfHeight : 0;
  const he = shape.halfExtents as { x: number; y: number; z: number } | undefined;
  if (he) return Math.hypot(he.x, he.y, he.z);
  return radius + halfHeight || 0.5;
}

export function TrampolineObjectSystem(ctx: GameContext) {
  const trampolines = liveTrampolines(ctx);
  if (trampolines.length === 0) {
    if (lastVy.size) lastVy = new Map();
    return;
  }
  const { physicsWorld } = getModule(ctx, PhysicsModule);
  const gravity = -physicsWorld.gravity.y;
  if (!(gravity > 0)) return;
  const owners = new Set(trampolines.map(ownBody).filter(Boolean));
  const next = new Map<number, number>();

  physicsWorld.forEachActiveRigidBody((body) => {
    if (!body.isDynamic() || owners.has(body)) return;
    const v = body.linvel();
    const before = lastVy.get(body.handle);
    next.set(body.handle, v.y);
    // Landed this step: it was falling fast and has (mostly) stopped falling.
    if (before === undefined || before > -MIN_IMPACT_SPEED || v.y < before * 0.5) return;
    const t = body.translation();
    const centre = [t.x, t.y, t.z];
    const r = reach(body);
    for (const trampoline of trampolines) {
      if (!isOnTrampoline(trampoline, centre, 0.25, r + 0.35)) continue;
      const up = objectBounceSpeed(trampoline, -before, gravity);
      if (up > v.y) {
        _v.x = v.x;
        _v.y = up;
        _v.z = v.z;
        body.setLinvel(_v, true);
        next.set(body.handle, up);
      }
      break;
    }
  });
  lastVy = next;
}
