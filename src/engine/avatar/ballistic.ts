/**
 * Buzzar: aiming something that fires a falling stream (a water gun) so it lands where you look. Pure three.js math,
 * stepped the same way the sprayer moves its drops (gravity, then drag, then move, at the game's tick).
 */
import { Vector3 } from "three";

export interface Ballistics {
  /** Metres per second the stream leaves at. */
  speed: number;
  /** m/s² downwards. */
  gravity: number;
  /** Fraction of speed lost per second. */
  drag: number;
  /** Seconds a drop flies before it's gone. */
  life: number;
}

const STEP = 1 / 60;

/** How high (metres, relative to the start) a stream fired `elevation` radians up is when it has gone `distance` out. */
function heightAt(b: Ballistics, elevation: number, distance: number) {
  let x = 0;
  let y = 0;
  let vx = Math.cos(elevation) * b.speed;
  let vy = Math.sin(elevation) * b.speed;
  for (let t = 0; t < b.life; t += STEP) {
    vy -= b.gravity * STEP;
    const keep = 1 - b.drag * STEP;
    vx *= keep;
    vy *= keep;
    const nx = x + vx * STEP;
    const ny = y + vy * STEP;
    if (nx >= distance) return y + ((ny - y) * (distance - x)) / (nx - x);
    x = nx;
    y = ny;
    if (vx < 1e-3) break;
  }
  return undefined;
}

/**
 * The direction to fire from `from` so the stream passes through `to` (the flatter of the two arcs that do), and
 * whether it can: if not, `direction` is the arc that comes closest. Undefined when it should just point straight at
 * it (nearly vertical).
 */
export function ballisticDirection(
  b: Ballistics,
  from: Vector3,
  to: Vector3
): { direction: Vector3; reached: boolean } | undefined {
  const offset = to.clone().sub(from);
  const height = offset.y;
  const flat = new Vector3(offset.x, 0, offset.z);
  const distance = flat.length();
  if (distance < 0.05) return undefined;
  flat.divideScalar(distance);
  const direct = Math.atan2(height, distance);
  // Lift from the straight line up to the furthest-reaching angle, finding where the arc first reaches the target.
  let low = direct;
  let best = direct;
  let bestMiss = Infinity;
  let high: number | undefined;
  const top = Math.min(Math.PI / 2 - 0.01, direct + Math.PI / 3);
  for (let a = direct; a <= top; a += Math.PI / 90) {
    const y = heightAt(b, a, distance);
    if (y === undefined) continue;
    const miss = height - y;
    if (Math.abs(miss) < bestMiss) [best, bestMiss] = [a, Math.abs(miss)];
    if (miss <= 0) {
      high = a;
      break;
    }
    low = a;
  }
  let elevation = best;
  if (high !== undefined) {
    // Narrow it down between the last angle that fell short and the first that reached.
    let reached: number = high;
    for (let i = 0; i < 12; i++) {
      const mid: number = (low + reached) / 2;
      const y = heightAt(b, mid, distance);
      if (y !== undefined && y >= height) reached = mid;
      else low = mid;
    }
    elevation = reached;
  }
  const direction = flat.multiplyScalar(Math.cos(elevation)).add(new Vector3(0, Math.sin(elevation), 0));
  return { direction, reached: high !== undefined };
}

/**
 * Aims along a line of sight: the direction to fire from `from` so the stream crosses the ray from `eye` along
 * `look`, at `distance` if it can reach that far, else at the furthest point along it that it can. Any point on that
 * ray is under the crosshair, so the stream meets the crosshair either way.
 */
export function aimAlongSight(b: Ballistics, from: Vector3, eye: Vector3, look: Vector3, distance: number) {
  const at = (d: number) => ballisticDirection(b, from, eye.clone().addScaledVector(look, d));
  const first = at(distance);
  if (!first || first.reached) return first?.direction;
  // Out of reach: find the furthest reachable point along the line of sight.
  let near = 0.5;
  let far = distance;
  let best = at(near);
  if (!best?.reached) return first.direction;
  for (let i = 0; i < 8; i++) {
    const mid = (near + far) / 2;
    const aim = at(mid);
    if (aim?.reached) [near, best] = [mid, aim];
    else far = mid;
  }
  return best.direction;
}
