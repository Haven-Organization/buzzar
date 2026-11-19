/**
 * Buzzar: Things (crates, balls, anything with a dynamic physics body) bounce on trampolines too, when thrown or
 * dropped on them. Runs right after the physics step: a body that was moving into the mat and has just been stopped
 * (or slowed hard) with its centre over a trampoline's bouncy area bounces off it (trampolines.ts,
 * objectBounceVelocity): its speed across the mat carries on and its speed into the mat comes back out, so one
 * tossed in at an angle bounces on and away at much the same angle.
 *
 * Only bodies this client simulates are dynamic (other clients' objects are kinematic copies), so each object's bounce
 * is worked out once, by its owner, and the network carries it to everyone else.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { vec3 } from "gl-matrix";

import { GameContext } from "../GameTypes";
import { getModule } from "../module/module.common";
import { PhysicsModule } from "../physics/physics.game";
import { RemoteNode } from "../resource/RemoteResources";
import { isOnTrampoline, liveTrampolines, objectBounceVelocity, Trampoline, trampolineNormal } from "./trampolines";

/** Body handle → its velocity after the previous step. */
let lastVelocity = new Map<number, [number, number, number]>();
/** Moving into the mat at least this fast (m/s) before the step counts as a landing. */
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

const _normal = vec3.create();
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function TrampolineObjectSystem(ctx: GameContext) {
  const trampolines = liveTrampolines(ctx);
  if (trampolines.length === 0) {
    if (lastVelocity.size) lastVelocity = new Map();
    return;
  }
  const { physicsWorld } = getModule(ctx, PhysicsModule);
  const gravity = -physicsWorld.gravity.y;
  if (!(gravity > 0)) return;
  const owners = new Set(trampolines.map(ownBody).filter(Boolean));
  const next = new Map<number, [number, number, number]>();

  physicsWorld.forEachActiveRigidBody((body) => {
    if (!body.isDynamic() || owners.has(body)) return;
    const lv = body.linvel();
    const v: [number, number, number] = [lv.x, lv.y, lv.z];
    const before = lastVelocity.get(body.handle);
    next.set(body.handle, v);
    if (!before) return;
    const t = body.translation();
    const centre = [t.x, t.y, t.z];
    const r = reach(body);
    for (const trampoline of trampolines) {
      if (!isOnTrampoline(trampoline, centre, 0.25, r + 0.35)) continue;
      // Landed this step: it was moving into the mat fast and has (mostly) stopped doing so.
      trampolineNormal(trampoline, _normal);
      const intoBefore = -dot(before, _normal);
      if (intoBefore < MIN_IMPACT_SPEED || -dot(v, _normal) > intoBefore * 0.5) break;
      // Bounce from the velocity it hit the mat with: the step's contact and friction have already stopped it,
      // so a ball tossed in at an angle used to pop straight up. Now it carries on and away, like off a real one.
      const out = objectBounceVelocity(trampoline, before, _normal, gravity);
      if (out && dot(out, _normal) > dot(v, _normal)) {
        _v.x = out[0];
        _v.y = out[1];
        _v.z = out[2];
        body.setLinvel(_v, true);
        next.set(body.handle, out);
      }
      break;
    }
  });
  lastVelocity = next;
}
