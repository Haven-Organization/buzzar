/**
 * Buzzar: objects that should always stand upright, like the trampoline: they only ever turn about the vertical.
 *
 * Their bodies lock tilting, but a hand can still turn them (holding sets the rotation directly), and a locked body
 * that lands tilted can never fall back flat. So holding keeps only the hand's heading, and anything left tilted
 * (thrown from an old hold, or set by another client) settles back level over a moment.
 */
import { quat } from "gl-matrix";

const uprightEids = new Set<number>();

export function markUpright(eid: number) {
  uprightEids.add(eid);
}

export function isUpright(eid: number) {
  return uprightEids.has(eid);
}

/** Every upright entity (callers drop ones that no longer exist with forgetUpright). */
export function uprightEntities(): ReadonlySet<number> {
  return uprightEids;
}

export function forgetUpright(eid: number) {
  uprightEids.delete(eid);
}

/** `out` = `q` with its tilt removed: the same heading (turn about +Y), standing level. */
export function levelRotation(out: quat, q: ArrayLike<number>): quat {
  // Heading from where the rotation sends -Z (forward), flattened onto the ground.
  const [x, y, z, w] = [q[0], q[1], q[2], q[3]];
  const fx = -2 * (x * z + w * y);
  const fz = -(1 - 2 * (x * x + y * y));
  if (Math.hypot(fx, fz) < 1e-6) return quat.copy(out, q as quat); // pointing straight up/down: keep as is
  return quat.setAxisAngle(out, [0, 1, 0], Math.atan2(-fx, -fz));
}

/** How far a rotation is tilted from level, in radians. */
export function tiltOf(q: ArrayLike<number>) {
  // Where it sends +Y: its y component is cos(tilt).
  const [x, , z] = [q[0], q[1], q[2]];
  const upY = 1 - 2 * (x * x + z * z);
  return Math.acos(Math.min(1, Math.max(-1, upY)));
}
