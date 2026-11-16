import { Bone, Group, Vector3 } from "three";

import { Blinker, createFaceRig, detectEyes, detectLids, getFaceSpec, updateFaceRig } from "./face";
import type { HumanoidMapping } from "./humanoid";

const mapping = (bones: Record<string, number> = {}): HumanoidMapping => ({
  format: "vrm1" as HumanoidMapping["format"],
  bones: new Map(Object.entries(bones)) as HumanoidMapping["bones"],
  facesNegativeZ: false,
});
const noBones = () => undefined;

describe("blinking", () => {
  it("blinks within a few seconds, fully closes, and opens again", () => {
    const blinker = new Blinker(() => 0.5);
    let max = 0;
    let closedFrames = 0;
    for (let i = 0; i < 60 * 4; i++) {
      const v = blinker.update(1 / 60);
      max = Math.max(max, v);
      if (v > 0.99) closedFrames++;
    }
    expect(max).toBe(1);
    // A blink is short: closed for only a couple of frames.
    expect(closedFrames).toBeLessThanOrEqual(3);
    expect(blinker.update(0.5)).toBe(0);
  });
});

describe("face sources", () => {
  it("uses the VRM 0.x blink group", () => {
    const spec = getFaceSpec(
      {
        extensions: {
          VRM: { blendShapeMaster: { blendShapeGroups: [{ presetName: "a", binds: [{ mesh: 0, index: 0, weight: 100 }] }, { presetName: "blink", binds: [{ mesh: 0, index: 5, weight: 100 }] }] } },
        },
      },
      mapping(),
      noBones,
      noBones
    ); // prettier-ignore
    expect(spec.blink).toEqual([{ mesh: 0, index: 5, weight: 1 }]);
  });

  it("uses VRM 1.0 blinkLeft + blinkRight when there is no blink", () => {
    const spec = getFaceSpec(
      {
        extensions: {
          VRMC_vrm: { expressions: { preset: { blinkLeft: { morphTargetBinds: [{ node: 3, index: 1, weight: 1 }] }, blinkRight: { morphTargetBinds: [{ node: 3, index: 2, weight: 1 }] } } } },
        },
      },
      mapping(),
      noBones,
      noBones
    ); // prettier-ignore
    expect(spec.blink.map((b) => b.index)).toEqual([1, 2]);
  });

  it("finds blink shapes by name, preferring a both-eyes shape over per-eye and ignoring look-alikes", () => {
    const gltf = {
      meshes: [{ extras: { targetNames: ["Fcl_EYE_Joy", "Fcl_EYE_Close_R", "Fcl_EYE_Close", "Fcl_EYE_Close_L", "blink_half"] } }],
    };
    expect(getFaceSpec(gltf, mapping(), noBones, noBones).blink).toEqual([{ mesh: 0, index: 2, weight: 1 }]);
    const arkit = { meshes: [{ extras: { targetNames: ["jawOpen", "eyeBlinkLeft", "eyeBlinkRight"] } }] };
    expect(getFaceSpec(arkit, mapping(), noBones, noBones).blink.map((b) => b.index)).toEqual([1, 2]);
  });

  it("slides upper eyelid bones down to the lower ones on the same side", () => {
    const pos: Record<number, Vector3> = {
      0: new Vector3(0.03, 1.5, 0.1), // BON_eyelid_up_L
      1: new Vector3(0.03, 1.48, 0.1), // BON_eyelid_lo_L
      2: new Vector3(-0.03, 1.5, 0.1), // BON_eyelid_up_R
      3: new Vector3(-0.03, 1.48, 0.1), // BON_eyelid_lo_R
    };
    const lids = detectLids(
      { nodes: [{ name: "BON_eyelid_up_L_0294" }, { name: "BON_eyelid_lo_L_0299" }, { name: "BON_eyelid_up_R_0262" }, { name: "BON_eyelid_lo_R_0286" }] },
      (i) => pos[i],
      (_i, offset) => offset.clone()
    )!; // prettier-ignore
    expect(lids.moves.map((m) => m.node)).toEqual([0, 2]);
    expect(lids.moves[0].delta[1]).toBeCloseTo(-0.02 * 0.88, 5);
  });

  it("finds eyes from the humanoid mapping, else by name", () => {
    expect(detectEyes({}, mapping({ leftEye: 4, rightEye: 5 }))).toEqual([4, 5]);
    const nodes = [{ name: "Bon_eyebrow01_L" }, { name: "BON_eyelid_up_L" }, { name: "Bon_eyeball_R_0290" }, { name: "Bon_eyeball_L_0295" }];
    expect(detectEyes({ nodes }, mapping())).toEqual([2, 3]);
  });
});

describe("gaze", () => {
  function rig() {
    const root = new Group();
    const head = new Bone();
    head.position.set(0, 1.5, 0);
    const eye = new Bone();
    eye.position.set(0.03, 0.05, 0.08);
    root.add(head);
    head.add(eye);
    root.updateMatrixWorld(true);
    const face = createFaceRig({
      spec: { blink: [], eyes: [1], look: { yaw: 12, pitchUp: 8, pitchDown: 10 } },
      objectFor: (i) => [head, eye][i],
      weightsFor: () => [],
      facesNegativeZ: false,
    })!;
    return { root, eye, face };
  }
  const gazeOf = (eye: Bone) => new Vector3(0, 0, 1).applyQuaternion(eye.quaternion);

  it("turns toward a person to the side, limited to the eye range", () => {
    const { eye, face } = rig();
    // About 33° to the right: the eyes turn part of the way (the rest would be a head turn).
    for (let i = 0; i < 30; i++) updateFaceRig(face, 1 / 60, [[1, 1.55, 1.5]], () => 0.5);
    const g = gazeOf(eye);
    expect(g.x).toBeGreaterThan(0.05); // looks toward +X
    expect((Math.atan2(g.x, g.z) * 180) / Math.PI).toBeLessThanOrEqual(12.01);
  });

  it("ignores people behind and itself", () => {
    const { eye, face } = rig();
    for (let i = 0; i < 30; i++) updateFaceRig(face, 1 / 60, [[0, 1.55, -2], [0.03, 1.55, 0.08]], () => 0.5);
    // Only the (zero, with random 0.5) wander remains: straight ahead.
    expect(gazeOf(eye).angleTo(new Vector3(0, 0, 1))).toBeLessThan(0.01);
  });
});

describe("blink binds", () => {
  it("resolves morph weights lazily (the loader adds them after the rig is built) and drives them", () => {
    // Filled in after the rig is built, like the loader does.
    const loaded: { weights?: Float32Array } = {};
    const face = createFaceRig({
      spec: { blink: [{ mesh: 0, index: 1, weight: 1 }], eyes: [], look: { yaw: 10, pitchUp: 10, pitchDown: 10 } },
      objectFor: () => undefined,
      weightsFor: () => (loaded.weights ? [loaded.weights] : []),
      facesNegativeZ: false,
    })!;
    expect(face).toBeDefined();
    const weights = (loaded.weights = new Float32Array(4));
    face.forceBlink = 1;
    updateFaceRig(face, 1 / 60, []);
    expect(weights[1]).toBe(1);
    face.forceBlink = 0;
    updateFaceRig(face, 1 / 60, []);
    expect(weights[1]).toBe(0);
  });
});
