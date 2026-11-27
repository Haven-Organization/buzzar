import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { aimAlongSight, ballisticDirection, Ballistics } from "./ballistic";

const gun: Ballistics = { speed: 10, gravity: 9.81, drag: 0.15, life: 1.6 };

/** Where a stream fired along `dir` from the origin is when it's `distance` out (as the sprayer steps drops). */
function heightAt(dir: Vector3, distance: number) {
  const p = new Vector3();
  const v = dir.clone().multiplyScalar(gun.speed);
  for (let t = 0; t < gun.life; t += 1 / 60) {
    v.y -= gun.gravity / 60;
    v.multiplyScalar(1 - gun.drag / 60);
    const next = p.clone().addScaledVector(v, 1 / 60);
    const flat = Math.hypot(next.x, next.z);
    if (flat >= distance) {
      const before = Math.hypot(p.x, p.z);
      return p.y + ((next.y - p.y) * (distance - before)) / (flat - before);
    }
    p.copy(next);
  }
  return undefined;
}

describe("ballisticDirection", () => {
  it("lifts the aim so the falling stream lands on a target straight ahead", () => {
    const target = new Vector3(0, 0, -6);
    const dir = ballisticDirection(gun, new Vector3(), target)!.direction;
    expect(dir.y).toBeGreaterThan(0);
    expect(heightAt(dir, 6)).toBeCloseTo(0, 1);
  });

  it("hits a target below and to the side", () => {
    const target = new Vector3(3, -1.4, -4);
    const dir = ballisticDirection(gun, new Vector3(), target)!.direction;
    expect(heightAt(dir, Math.hypot(3, 4))).toBeCloseTo(-1.4, 1);
    // Still points the same way across the ground.
    expect(dir.x / -dir.z).toBeCloseTo(3 / 4, 3);
  });

  it("takes the flatter arc", () => {
    const dir = ballisticDirection(gun, new Vector3(), new Vector3(0, 0, -3))!.direction;
    expect(Math.asin(dir.y)).toBeLessThan(Math.PI / 4);
  });

  it("says when a target is out of reach", () => {
    expect(ballisticDirection(gun, new Vector3(), new Vector3(0, 0, -40))!.reached).toBe(false);
  });

  it("aims at the furthest point along the line of sight it can reach", () => {
    // Looking level from 0.3 m above the nozzle at something 40 m away.
    const eye = new Vector3(0, 0.3, 0);
    const look = new Vector3(0, 0, -1);
    const dir = aimAlongSight(gun, new Vector3(), eye, look, 40)!;
    // It crosses the line of sight (y = 0.3) somewhere out in front.
    let p = new Vector3();
    const v = dir.clone().multiplyScalar(gun.speed);
    let crossed = false;
    for (let t = 0; t < gun.life; t += 1 / 60) {
      v.y -= gun.gravity / 60;
      v.multiplyScalar(1 - gun.drag / 60);
      const next = p.clone().addScaledVector(v, 1 / 60);
      if (t > 0.1 && (p.y - 0.3) * (next.y - 0.3) <= 0) crossed = true;
      p = next;
    }
    expect(crossed).toBe(true);
  });

  it("leaves straight up and down alone", () => {
    expect(ballisticDirection(gun, new Vector3(), new Vector3(0, 5, 0))).toBeUndefined();
  });
});
