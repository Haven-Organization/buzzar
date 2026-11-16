import { Bone, Group, Vector3 } from "three";

import { Blinker, createFaceRig, detectEyes, detectLids, detectLips, getFaceSpec, updateFaceRig } from "./face";
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

describe("lip sync", () => {
  it("reads VRM 0.x vowel groups in aa/ih/ou/ee/oh order", () => {
    const groups = ["a", "i", "u", "e", "o"].map((p, i) => ({ presetName: p, binds: [{ mesh: 0, index: 10 + i, weight: 100 }] }));
    const spec = getFaceSpec({ extensions: { VRM: { blendShapeMaster: { blendShapeGroups: groups } } } }, mapping(), noBones, noBones);
    expect(spec.mouth!.map((s) => s[0].index)).toEqual([10, 11, 12, 13, 14]);
  });

  it("finds mouth shapes by name (VRoid, VRChat, ARKit)", () => {
    const spec = getFaceSpec(
      { meshes: [{ extras: { targetNames: ["Fcl_MTH_A", "vrc.v_ih", "mouthFunnel", "Fcl_MTH_E", "vrc.v_oh", "Fcl_EYE_Close"] } }] },
      mapping(),
      noBones,
      noBones
    );
    expect(spec.mouth!.map((s) => s.map((b) => b.index))).toEqual([[0], [1], [2], [3], [4]]);
  });

  it("drives mouth blend shapes from visemes without fighting the blink", () => {
    const weights = new Float32Array(8);
    const face = createFaceRig({
      spec: {
        blink: [{ mesh: 0, index: 0, weight: 1 }],
        mouth: [[{ mesh: 0, index: 1, weight: 1 }], [], [], [], []],
        eyes: [],
        look: { yaw: 10, pitchUp: 10, pitchDown: 10 },
      },
      objectFor: () => undefined,
      weightsFor: () => [weights],
      facesNegativeZ: false,
    })!;
    face.forceBlink = 0;
    updateFaceRig(face, 1 / 60, [], () => 0.5, [0.8, 0, 0, 0, 0]);
    expect(weights[1]).toBeCloseTo(0.8);
    expect(weights[0]).toBe(0);
    updateFaceRig(face, 1 / 60, [], () => 0.5, [0, 0, 0, 0, 0]);
    expect(weights[1]).toBe(0);
  });

  it("moves lip bones in the mouth's own frame, even when the head is tilted in the rest pose", () => {
    // Mouth 3 cm wide, rolled 30° (right corner lower), facing +Z.
    const roll = Math.PI / 6;
    const at = (x: number, y: number) => new Vector3(x * Math.cos(roll) - y * Math.sin(roll), 1.4 + x * Math.sin(roll) + y * Math.cos(roll), 0.1);
    const pos: Record<number, Vector3> = { 0: at(-0.015, 0), 1: at(0.015, 0), 2: at(0, 0.002), 3: at(0, -0.002), 4: at(0, -0.006), 5: new Vector3(0, 1.5, 0) };
    const nodes = [{ name: "Bon_colip_R_0261" }, { name: "Bon_colip_L_0272" }, { name: "Bon_uplip_M_0266" }, { name: "Bon_Lolip_M_0267" }, { name: "Bon_yachi_lo_0260" }, { name: "Head" }];
    const lips = detectLips({ nodes }, (i) => pos[i], (_i, o) => o.clone(), 5)!;
    const move = (i: number) => lips.moves.find((m) => m.node === i)!;
    const right = new Vector3().subVectors(pos[1], pos[0]).normalize();
    const up = new Vector3(-Math.sin(roll), Math.cos(roll), 0);
    // Opening drops the lower lip and the lower teeth along the mouth's (tilted) down, and lifts the upper lip.
    expect(new Vector3(...move(3).open).dot(up)).toBeLessThan(-0.01);
    expect(new Vector3(...move(4).open).dot(up)).toBeLessThan(-0.008);
    expect(new Vector3(...move(2).open).dot(up)).toBeGreaterThan(0);
    // "oo" pulls the corners toward the middle along the mouth, and pushes the lips forward.
    expect(new Vector3(...move(0).round).dot(right)).toBeGreaterThan(0.005);
    expect(new Vector3(...move(1).round).dot(right)).toBeLessThan(-0.005);
    expect(move(3).round[2]).toBeGreaterThan(0);
  }); // prettier-ignore

  it("opens a jaw bone with the voice", () => {
    const root = new Group();
    const head = new Bone();
    const jaw = new Bone();
    jaw.position.set(0, -0.05, 0.02);
    root.add(head);
    head.add(jaw);
    root.updateMatrixWorld(true);
    const face = createFaceRig({
      spec: { blink: [], eyes: [], look: { yaw: 10, pitchUp: 10, pitchDown: 10 }, jaw: 1 },
      objectFor: (i) => [head, jaw][i],
      weightsFor: () => [],
      facesNegativeZ: false,
    })!;
    updateFaceRig(face, 1 / 60, [], () => 0.5, [1, 0, 0, 0, 0]);
    // The jaw's forward (+Z) tips downward.
    expect(new Vector3(0, 0, 1).applyQuaternion(jaw.quaternion).y).toBeLessThan(-0.1);
  });
});
