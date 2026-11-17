import { vec3 } from "gl-matrix";

const _offset = vec3.create();

/**
 * Buzzar: tilts `direction` (in place) by a random angle of up to about `maxRadians`, keeping its length. Throws and
 * spawns that all follow exactly the same path look mechanical (Third Room #297).
 */
export function jitterDirection(direction: vec3, maxRadians: number, random: () => number = Math.random): vec3 {
  const length = vec3.length(direction);
  if (length === 0) return direction;
  // A random point in the unit ball (rejection sampling), scaled to the tilt.
  do {
    vec3.set(_offset, random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
  } while (vec3.squaredLength(_offset) > 1);
  vec3.scaleAndAdd(direction, direction, _offset, length * Math.tan(maxRadians));
  vec3.scale(direction, direction, length / vec3.length(direction));
  return direction;
}
