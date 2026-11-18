/**
 * Buzzar: renders a preview picture of an avatar (full body from the front, arms lowered from the T-pose, transparent
 * background), for avatars uploaded without one. Same framing as the bundled stock previews.
 */
import {
  Bone,
  Box3,
  Matrix4,
  Mesh,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SkinnedMesh,
  sRGBEncoding,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

import { getHumanoidMapping, HumanBone } from "../../engine/avatar/humanoid";
import { GLTFRoot } from "../../engine/gltf/GLTF";

const WIDTH = 360;
const HEIGHT = 480;
const FOV = 30;
/** Upper and lower arms point this far below horizontal. */
const ARM_DOWN = (70 * Math.PI) / 180;

async function nodeFor(gltf: GLTF, index: number | undefined): Promise<Object3D | undefined> {
  if (index === undefined) return undefined;
  try {
    return (await gltf.parser.getDependency("node", index)) as Object3D;
  } catch {
    return undefined;
  }
}

const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();
const _pq = new Quaternion();

/** Rotates `bone` (in world space) so it points from its position toward `toward`'s along `target`. */
function aim(bone: Object3D, toward: Object3D, target: Vector3) {
  bone.updateWorldMatrix(true, false);
  toward.updateWorldMatrix(true, false);
  bone.getWorldPosition(_a);
  toward.getWorldPosition(_b);
  const dir = _b.sub(_a);
  if (dir.lengthSq() < 1e-8) return;
  dir.normalize();
  const delta = new Quaternion().setFromUnitVectors(dir, target);
  bone.getWorldQuaternion(_q);
  const newWorld = delta.multiply(_q);
  if (bone.parent) bone.parent.getWorldQuaternion(_pq);
  else _pq.identity();
  bone.quaternion.copy(_pq.invert().multiply(newWorld));
  bone.updateMatrixWorld(true);
}

async function lowerArms(gltf: GLTF, bones: Map<HumanBone, number>) {
  for (const side of ["left", "right"] as const) {
    const upper = await nodeFor(gltf, bones.get(`${side}UpperArm`));
    const lower = await nodeFor(gltf, bones.get(`${side}LowerArm`));
    const hand = await nodeFor(gltf, bones.get(`${side}Hand`));
    if (!upper || !lower) continue;
    upper.updateWorldMatrix(true, false);
    lower.updateWorldMatrix(true, false);
    const x = lower.getWorldPosition(new Vector3()).x - upper.getWorldPosition(new Vector3()).x;
    const target = new Vector3(Math.sign(x || 1) * Math.cos(ARM_DOWN), -Math.sin(ARM_DOWN), 0);
    aim(upper, lower, target);
    if (hand) aim(lower, hand, target);
  }
}

/** Bounds of what's actually drawn (skinned meshes as posed), sampling up to ~4000 vertices per mesh. */
function skinnedBounds(root: Object3D) {
  const box = new Box3();
  const v = new Vector3();
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    const skinned = (mesh as SkinnedMesh).isSkinnedMesh ? (mesh as SkinnedMesh) : undefined;
    skinned?.skeleton.update();
    const step = Math.max(1, Math.floor(position.count / 4000));
    for (let i = 0; i < position.count; i += step) {
      v.fromBufferAttribute(position, i);
      if (skinned) skinned.boneTransform(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(v);
    }
  });
  return box;
}

/**
 * Buzzar: how a preview is framed. "avatar": full body from the front (360×480). "thing": an object from a front
 * corner, a little above (360×480). "world": a scene seen from above one corner (640×360).
 */
export type PreviewView = "avatar" | "thing" | "world";

const VIEWS: Record<PreviewView, { width: number; height: number; direction: Vector3; margin: number }> = {
  avatar: { width: WIDTH, height: HEIGHT, direction: new Vector3(0, 0, 1), margin: 1.1 },
  thing: { width: WIDTH, height: HEIGHT, direction: new Vector3(0.75, 0.55, 1).normalize(), margin: 1.35 },
  world: { width: 640, height: 360, direction: new Vector3(0.7, 0.75, 1).normalize(), margin: 1.05 },
};

/** Renders a PNG preview of an avatar file (.glb / .vrm), or with `view`, of a Thing or a world. */
export async function renderAvatarPreview(file: ArrayBuffer, view: PreviewView = "avatar"): Promise<Blob> {
  const frame = VIEWS[view];
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(file, "");
  const scene = new Scene();
  const root = gltf.scene;
  scene.add(root);
  root.updateMatrixWorld(true);
  // The nodes may hold an animation frame rather than the rest pose: give every bone its bind pose (usually a T-pose)
  // relative to its parent bone. Root bones keep their node transform, which keeps the model upright in the scene
  // (Skeleton.pose() would use the bind frame, which some files have rotated).
  const bindLocal = new Map<Object3D, Matrix4>();
  root.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const { bones, boneInverses } = mesh.skeleton;
    bones.forEach((bone, i) => {
      const parentIndex = bone.parent ? bones.indexOf(bone.parent as Bone) : -1;
      if (parentIndex < 0 || bindLocal.has(bone)) return;
      bindLocal.set(bone, boneInverses[parentIndex].clone().multiply(boneInverses[i].clone().invert()));
    });
  });
  for (const [bone, matrix] of bindLocal) matrix.decompose(bone.position, bone.quaternion, bone.scale);
  root.updateMatrixWorld(true);

  const mapping = getHumanoidMapping(gltf.parser.json as GLTFRoot);
  if (mapping) await lowerArms(gltf, mapping.bones);
  root.updateMatrixWorld(true);

  const box = skinnedBounds(root);
  if (box.isEmpty()) throw new Error("Avatar has no visible geometry");
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const facing = frame.direction.clone();
  if (mapping?.facesNegativeZ) facing.z = -facing.z;

  const camera = new PerspectiveCamera(FOV, frame.width / frame.height, 0.01, 100000);
  let dist: number;
  if (view === "avatar") {
    const fitHeight = Math.max(size.y, (size.x * frame.height) / frame.width) * frame.margin;
    dist = fitHeight / 2 / Math.tan((FOV * Math.PI) / 360) + size.z / 2;
  } else {
    // Fit the bounding sphere, whichever way it's seen from.
    const radius = (size.length() / 2) * frame.margin;
    const fov = Math.min(
      FOV,
      (2 * Math.atan(Math.tan((FOV * Math.PI) / 360) * (frame.width / frame.height)) * 180) / Math.PI
    );
    dist = radius / Math.sin((fov * Math.PI) / 360);
  }
  camera.position.copy(center).addScaledVector(facing, dist);
  camera.lookAt(center);

  scene.add(new HemisphereLight(0xffffff, 0x444455, 1.6));
  const key = new DirectionalLight(0xffffff, 1.4);
  key.position.copy(center).addScaledVector(facing, 3).add(new Vector3(1.5, 2.5, 0));
  key.target.position.copy(center);
  scene.add(key, key.target);

  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
    multiviewStereo: false,
  });
  try {
    renderer.outputEncoding = sRGBEncoding;
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode the preview"))), "image/png")
    );
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
    scene.traverse((object) => {
      const mesh = object as { geometry?: { dispose(): void }; material?: unknown };
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const material of materials as { dispose(): void; [key: string]: unknown }[]) {
        for (const value of Object.values(material)) {
          if (value && typeof value === "object" && "isTexture" in value)
            (value as unknown as { dispose(): void }).dispose();
        }
        material.dispose();
      }
    });
  }
}

/** One render at a time (each loads a whole avatar), with results cached by avatar URL for this session. */
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Promise<Blob>>();

export function renderAvatarPreviewFromUrl(key: string, httpUrl: string, view: PreviewView = "avatar"): Promise<Blob> {
  key = view === "avatar" ? key : `${view}:${key}`;
  let result = cache.get(key);
  if (!result) {
    result = queue.then(async () => {
      const res = await fetch(httpUrl);
      if (!res.ok) throw new Error(`Couldn't download the file (${res.status})`);
      return renderAvatarPreview(await res.arrayBuffer(), view);
    });
    queue = result.catch(() => undefined);
    // Failures aren't cached, so a later look tries again.
    result.catch(() => cache.delete(key));
    cache.set(key, result);
  }
  return result;
}
