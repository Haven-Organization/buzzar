import { Bone, Group, Matrix4, Vector3 } from "three";

import type { HumanoidMapping } from "./humanoid";
import {
  createSpringRig,
  detectSpringChains,
  getSpringChains,
  parseVRM0Springs,
  parseVRM1Springs,
  SpringChainSpec,
  SpringSettings,
  updateSpringRig,
} from "./springBones";

const mapping = (bones: Record<string, number>): HumanoidMapping => ({
  format: "vrm1" as HumanoidMapping["format"],
  bones: new Map(Object.entries(bones)) as HumanoidMapping["bones"],
  facesNegativeZ: false,
});

/** head (0) → hair (1) → hair tip (2), hair hanging forward along +Z, 10 cm per segment. */
function makeChain() {
  const root = new Group();
  const head = new Bone();
  head.position.set(0, 1.5, 0);
  const hair = new Bone();
  hair.position.set(0, 0.1, 0);
  const tip = new Bone();
  tip.position.set(0, 0, 0.1);
  root.add(head);
  head.add(hair);
  hair.add(tip);
  const objs = [head, hair, tip];
  return { root, head, hair, tip, objectFor: (i: number) => objs[i] };
}

const spec = (settings: Partial<SpringSettings> = {}): SpringChainSpec => ({
  joints: [1],
  settings: { stiffness: 1, gravityPower: 0, gravityDir: new Vector3(0, -1, 0), dragForce: 0.4, hitRadius: 0, ...settings },
  colliders: [],
});

const tipWorld = (tip: Bone) => new Vector3().setFromMatrixPosition(tip.matrixWorld);
const at = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z).toArray();

describe("spring bone simulation", () => {
  it("stays at rest when nothing moves and there is no gravity", () => {
    const { root, tip, objectFor } = makeChain();
    const rig = createSpringRig([spec()], objectFor)!;
    for (let i = 0; i < 60; i++) updateSpringRig(rig, root, at(0, 0, 0), 1 / 60);
    expect(tipWorld(tip).distanceTo(new Vector3(0, 1.6, 0.1))).toBeLessThan(1e-4);
  });

  it("droops under gravity but keeps the bone length", () => {
    const { root, hair, tip, objectFor } = makeChain();
    const rig = createSpringRig([spec({ stiffness: 0.2, gravityPower: 1 })], objectFor)!;
    for (let i = 0; i < 120; i++) updateSpringRig(rig, root, at(0, 0, 0), 1 / 60);
    const t = tipWorld(tip);
    expect(t.y).toBeLessThan(1.6 - 0.02);
    expect(t.distanceTo(new Vector3().setFromMatrixPosition(hair.matrixWorld))).toBeCloseTo(0.1, 4);
  });

  it("lags behind when the avatar moves, then settles back", () => {
    const { root, tip, objectFor } = makeChain();
    const rig = createSpringRig([spec({ stiffness: 2, dragForce: 0.5 })], objectFor)!;
    updateSpringRig(rig, root, at(0, 0, 0), 1 / 60);
    // Step sideways (+X) by 5 cm in one frame: the tip trails behind the joint.
    updateSpringRig(rig, root, at(0.05, 0, 0), 1 / 60);
    expect(tipWorld(tip).x).toBeLessThan(0.05 - 0.005);
    for (let i = 0; i < 300; i++) updateSpringRig(rig, root, at(0.05, 0, 0), 1 / 60);
    expect(tipWorld(tip).distanceTo(new Vector3(0.05, 1.6, 0.1))).toBeLessThan(1e-3);
  });

  it("snaps back to rest after a teleport instead of swinging wildly", () => {
    const { root, tip, objectFor } = makeChain();
    const rig = createSpringRig([spec({ stiffness: 0.5, dragForce: 0.1 })], objectFor)!;
    updateSpringRig(rig, root, at(0, 0, 0), 1 / 60);
    updateSpringRig(rig, root, at(50, 0, 0), 1 / 60);
    expect(tipWorld(tip).distanceTo(new Vector3(50, 1.6, 0.1))).toBeLessThan(1e-4);
  });

  it("is pushed out of a sphere collider", () => {
    const { root, head, tip, objectFor } = makeChain();
    const chain = spec({ stiffness: 0, gravityPower: 2 });
    // A ball just below and in front of the hair joint: gravity would otherwise swing the tip through it.
    chain.colliders = [{ node: 0, offset: [0, 0.03, 0.1], radius: 0.05 }];
    const rig = createSpringRig([chain], objectFor)!;
    for (let i = 0; i < 120; i++) updateSpringRig(rig, root, at(0, 0, 0), 1 / 60);
    const ball = new Vector3(0, 0.03, 0.1).applyMatrix4(head.matrixWorld);
    expect(tipWorld(tip).distanceTo(ball)).toBeGreaterThanOrEqual(0.05 - 1e-4);
  });
});

describe("spring bone sources", () => {
  it("reads VRM 0.x bone groups, including descendants, and flips z", () => {
    const chains = parseVRM0Springs({
      nodes: [{ children: [1] }, { children: [2] }, {}],
      extensions: {
        VRM: {
          secondaryAnimation: {
            boneGroups: [{ stiffiness: 2, gravityPower: 0.5, gravityDir: { x: 0, y: 0, z: 1 }, dragForce: 0.3, hitRadius: 0.05, bones: [1], colliderGroups: [0] }],
            colliderGroups: [{ node: 0, colliders: [{ offset: { x: 0, y: 0.1, z: 0.2 }, radius: 0.1 }] }],
          },
        },
      },
    })!; // prettier-ignore
    expect(chains).toHaveLength(1);
    expect(chains[0].joints).toEqual([1, 2]);
    const settings = chains[0].settings as SpringSettings;
    expect(settings.stiffness).toBe(2);
    expect(settings.gravityDir.z).toBe(-1);
    expect(chains[0].colliders[0].offset).toEqual([0, 0.1, -0.2]);
  });

  it("reads VRM 1.0 springs with per-joint settings and the tip joint", () => {
    const chains = parseVRM1Springs({
      extensions: {
        VRMC_springBone: {
          colliders: [{ node: 0, shape: { capsule: { offset: [0, 0, 0], radius: 0.05, tail: [0, 0.2, 0] } } }],
          colliderGroups: [{ colliders: [0] }],
          springs: [{ joints: [{ node: 1, stiffness: 3 }, { node: 2, stiffness: 1 }, { node: 3 }], colliderGroups: [0] }],
        },
      },
    })!;
    expect(chains[0].joints).toEqual([1, 2, 3]);
    expect(chains[0].lastIsTip).toBe(true);
    expect((chains[0].settings as { stiffness: number }[]).map((s) => s.stiffness)).toEqual([3, 1, 1]);
    expect(chains[0].colliders[0].tail).toEqual([0, 0.2, 0]);
  });

  it("detects hair, ears and ribbons on plain glTF avatars, not twist bones or the skeleton", () => {
    const gltf = {
      nodes: [
        { name: "Head", children: [1, 3, 5] },
        { name: "Bn_m_hair_001", children: [2] },
        { name: "Bn_m_hair_002" },
        { name: "Bn_l_ear_001", children: [4] },
        { name: "Bn_l_ear_002" },
        { name: "Bone_ribbon00" },
        { name: "Bone-L-ForeArm-Twist_0106" },
        { name: "Upper Chest", children: [6, 8] },
        { name: "B_chestbow00" },
        { name: "Hair_Unattached" },
      ],
      skins: [{ joints: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }],
    };
    const chains = detectSpringChains(gltf, mapping({ head: 0, upperChest: 7 }));
    const roots = chains.map((c) => gltf.nodes[c.joints[0]].name);
    expect(roots).toEqual(["Bn_m_hair_001", "Bn_l_ear_001", "Bone_ribbon00", "B_chestbow00"]);
    expect(chains[0].joints).toEqual([1, 2]);
    // Ears are stiffer than hair.
    const stiff = (i: number) => (chains[i].settings as { stiffness: number }).stiffness;
    expect(stiff(1)).toBeGreaterThan(stiff(0));
  });

  it("prefers VRM data over name detection", () => {
    const gltf = {
      nodes: [{ name: "Head", children: [1] }, { name: "hair" }],
      skins: [{ joints: [0, 1] }],
      extensions: { VRM: { secondaryAnimation: { boneGroups: [], colliderGroups: [] } } },
    };
    expect(getSpringChains(gltf, mapping({ head: 0 }))).toEqual([]);
  });
});

describe("spring rig building", () => {
  it("keeps hubs with several strands fixed and swings the strands", () => {
    const root = new Group();
    const hub = new Bone();
    const a = new Bone();
    const b = new Bone();
    a.position.set(0.1, 0, 0);
    b.position.set(-0.1, 0, 0);
    root.add(hub);
    hub.add(a, b);
    const objs = [hub, a, b];
    const rig = createSpringRig(
      [{ joints: [0, 1, 2], settings: { stiffness: 1, gravityPower: 0, gravityDir: new Vector3(0, -1, 0), dragForce: 0.4, hitRadius: 0 }, colliders: [] }],
      (i) => objs[i]
    )!; // prettier-ignore
    expect(rig.joints.map((j) => j.bone)).toEqual([a, b]);
  });
});
