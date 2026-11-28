import { describe, expect, it } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";

import { createHoldRig, handFrameNow, reachFor } from "./holdPose";
import { squareShoulders } from "./holdRig";
import { HumanBone } from "./humanoid";

/** A right arm in a T-pose: along +X, palm down, thumb forward (-Z). */
function makeArm() {
  const root = new Object3D();
  const bones = new Map<string, Object3D>();
  const add = (name: string, parent: Object3D, at: [number, number, number]) => {
    const obj = new Object3D();
    obj.position.set(...at);
    parent.add(obj);
    bones.set(name, obj);
    return obj;
  };
  const upper = add("rightUpperArm", root, [0.2, 1.4, 0]);
  const lower = add("rightLowerArm", upper, [0.3, 0, 0]);
  const hand = add("rightHand", lower, [0.25, 0, 0]);
  add("rightIndexProximal", hand, [0.08, 0, -0.025]);
  add("rightMiddleProximal", hand, [0.085, 0, 0]);
  add("rightRingProximal", hand, [0.08, 0, 0.02]);
  add("rightLittleProximal", hand, [0.07, 0, 0.04]);
  add("rightThumbProximal", hand, [0.02, -0.01, -0.03]);
  add("rightThumbDistal", hand, [0.05, -0.015, -0.06]);
  root.updateMatrixWorld(true);
  return { root, rig: createHoldRig((bone: HumanBone) => bones.get(bone))! };
}

describe("holding Items: arm IK", () => {
  it("finds the handshake frame from the fingers (T-pose: thumb forward)", () => {
    const { rig } = makeArm();
    const frame = handFrameNow(rig, "right")!;
    // Fingers (-Z of the frame) point along the arm (+X); the thumb (+Y of the frame) points forward (-Z).
    expect(new Vector3(0, 0, -1).applyQuaternion(frame.rotation).x).toBeCloseTo(1, 3);
    expect(new Vector3(0, 1, 0).applyQuaternion(frame.rotation).z).toBeCloseTo(-1, 3);
  });

  it("puts the palm on a reachable target, facing the way asked", () => {
    const { rig } = makeArm();
    const target = new Vector3(0.3, 1.25, -0.4);
    // A handshake straight ahead: fingers forward (-Z), thumb up.
    reachFor(rig, "right", target, new Quaternion(), new Vector3(0.6, 0.8, 0.2));
    const frame = handFrameNow(rig, "right")!;
    expect(frame.palm.distanceTo(target)).toBeLessThan(0.002);
    expect(frame.rotation.angleTo(new Quaternion())).toBeLessThan(0.01);
  });

  it("reaches as far as it can toward a target out of reach", () => {
    const { rig } = makeArm();
    reachFor(rig, "right", new Vector3(0.2, 1.4, -3), new Quaternion(), new Vector3(0.6, 0.8, 0.2));
    const palm = handFrameNow(rig, "right")!.palm;
    expect(palm.z).toBeLessThan(-0.5);
  });
});

describe("holding Items: square shoulders", () => {
  it("turns the chest back to face the way the avatar does, keeping the hips' turn", () => {
    const root = new Object3D();
    root.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.7);
    const bones = new Map<string, Object3D>();
    const add = (name: string, parent: Object3D, at: [number, number, number]) => {
      const obj = new Object3D();
      obj.position.set(...at);
      parent.add(obj);
      bones.set(name, obj);
      return obj;
    };
    const hips = add("hips", root, [0, 1, 0]);
    const spine = add("spine", hips, [0, 0.1, 0]);
    const chest = add("chest", spine, [0, 0.15, 0]);
    add("rightUpperArm", chest, [0.2, 0.2, 0]);
    add("rightLowerArm", bones.get("rightUpperArm")!, [0.3, 0, 0]);
    add("rightHand", bones.get("rightLowerArm")!, [0.25, 0, 0]);
    root.updateMatrixWorld(true);
    const rig = createHoldRig((bone: HumanBone) => bones.get(bone), root)!;

    // A strafe step: hips turned 50°, chest leaning a little and turned 20° more.
    const up = new Vector3(0, 1, 0);
    hips.quaternion.setFromAxisAngle(up, 0.87);
    chest.quaternion.setFromAxisAngle(up, 0.35).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.1));
    root.updateMatrixWorld(true);

    squareShoulders(rig);
    const forward = new Vector3(0, 0, 1).applyQuaternion(chest.getWorldQuaternion(new Quaternion()));
    const body = new Vector3(0, 0, 1).applyQuaternion(root.quaternion);
    forward.y = 0;
    expect(forward.normalize().dot(body)).toBeCloseTo(1, 4);
    // The hips (and so the legs) keep their step.
    expect(hips.quaternion.angleTo(new Quaternion().setFromAxisAngle(up, 0.87))).toBeLessThan(1e-6);
  });
});
