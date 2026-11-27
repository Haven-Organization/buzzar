/**
 * Buzzar (Third Room #461): draws the world from straight above, once, when its creator presses "Generate Map" in
 * World Settings. Only the world's own geometry is drawn (not people or spawned Items), fitted to its extent with
 * north (-Z) up; `cutHeight` leaves out everything above that height so the insides of buildings show. The picture
 * goes back to the main thread to be uploaded (see plugins/world-map).
 */
import {
  Box3,
  Color,
  Mesh,
  Object3D,
  OrthographicCamera,
  Plane,
  sRGBEncoding,
  Vector3,
  WebGLRenderTarget,
} from "three";

import { getModule, Thread } from "../../module/module.common";
import { getLocalResources, RenderNode } from "../RenderResources";
import { RenderContext, RendererModule } from "../renderer.render";
import { collectSceneNodes } from "./WorldShadowsSystem";
import {
  WorldMapArea,
  WorldMapGenerateMessage,
  WorldMapGeneratedMessage,
  WorldMapMessageType,
} from "../../../plugins/world-map/worldMap.common";

/** The picture's longer side (px). */
const MAP_PIXELS = 2048;
/** Meshes wider than this are skies, oceans or terrain to the horizon: drawn, but they don't stretch the map. */
const MAX_MESH_SPAN = 2000;
/** The most ground one map covers (m). */
const MAX_MAP_SPAN = 1000;

const pending: WorldMapGenerateMessage[] = [];

export function onGenerateWorldMap(_ctx: RenderContext, message: WorldMapGenerateMessage) {
  pending.push(message);
}

const _box = new Box3();
const _size = new Vector3();
const _center = new Vector3();

/** The ground a set of meshes covers, ignoring ones that reach the horizon. */
export function mapBounds(meshes: Object3D[]): Box3 {
  const bounds = new Box3();
  for (const mesh of meshes) {
    _box.setFromObject(mesh);
    if (_box.isEmpty()) continue;
    _box.getSize(_size);
    if (_size.x > MAX_MESH_SPAN || _size.z > MAX_MESH_SPAN) continue;
    bounds.union(_box);
  }
  return bounds;
}

/** A square-ish area around the bounds with a small margin, no wider than MAX_MAP_SPAN, in whole centimetres. */
export function mapArea(bounds: Box3): WorldMapArea {
  bounds.getCenter(_center);
  bounds.getSize(_size);
  const w = Math.min(MAX_MAP_SPAN, Math.max(4, _size.x * 1.04));
  const d = Math.min(MAX_MAP_SPAN, Math.max(4, _size.z * 1.04));
  const cm = (m: number) => Math.round(m * 100) / 100;
  return {
    minX: cm(_center.x - w / 2),
    maxX: cm(_center.x + w / 2),
    minZ: cm(_center.z - d / 2),
    maxZ: cm(_center.z + d / 2),
  };
}

export function WorldMapCaptureSystem(ctx: RenderContext) {
  const request = pending.shift();
  if (!request) return;
  const reply = (result: Omit<WorldMapGeneratedMessage, "type" | "id">) =>
    ctx.sendMessage<WorldMapGeneratedMessage>(Thread.Main, {
      type: WorldMapMessageType.Generated,
      id: request.id,
      ...result,
    });

  capture(ctx, request).then(reply, (error) =>
    reply({ error: error instanceof Error ? error.message : String(error) })
  );
}

async function capture(ctx: RenderContext, request: WorldMapGenerateMessage) {
  const rendererModule = getModule(ctx, RendererModule);
  const { renderer, scene } = rendererModule;
  const publicScene = ctx.worldResource.environment?.publicScene;
  if (!publicScene) throw new Error("No world is loaded.");

  const worldNodes = new Set<RenderNode>();
  collectSceneNodes(publicScene, worldNodes);

  // Show the world's own meshes (as they'd be without instancing), hide everything else; put it all back after.
  const restore: { object: Object3D; visible: boolean }[] = [];
  const setVisible = (object: Object3D, visible: boolean) => {
    restore.push({ object, visible: object.visible });
    object.visible = visible;
  };
  const worldMeshes: Mesh[] = [];
  const nodes = getLocalResources(ctx, RenderNode);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const objects = node.meshPrimitiveObjects;
    if (!objects) continue;
    const isWorld = worldNodes.has(node) && node.object3DVisible;
    for (const object of objects) {
      setVisible(object, isWorld);
      if (isWorld) worldMeshes.push(object as Mesh);
    }
  }
  for (const child of scene.children) if (child.name === "AutoInstanced") setVisible(child, false);
  setVisible(rendererModule.xrAvatarRoot, false);

  const bounds = mapBounds(worldMeshes);
  if (bounds.isEmpty()) {
    for (let i = restore.length - 1; i >= 0; i--) restore[i].object.visible = restore[i].visible;
    throw new Error("This world has nothing to draw.");
  }
  const area = mapArea(bounds);
  const spanX = area.maxX - area.minX;
  const spanZ = area.maxZ - area.minZ;
  const width = Math.round(spanX >= spanZ ? MAP_PIXELS : (MAP_PIXELS * spanX) / spanZ);
  const height = Math.round(spanZ >= spanX ? MAP_PIXELS : (MAP_PIXELS * spanZ) / spanX);

  const top = bounds.max.y + 10;
  const camera = new OrthographicCamera(-spanX / 2, spanX / 2, spanZ / 2, -spanZ / 2, 0.1, top - bounds.min.y + 10);
  camera.position.set((area.minX + area.maxX) / 2, top, (area.minZ + area.maxZ) / 2);
  camera.up.set(0, 0, -1); // north (-Z) at the top, east (+X) to the right
  camera.lookAt(camera.position.x, bounds.min.y, camera.position.z);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  // An sRGB target: the GPU encodes on write, so the bytes read back are ready for an image.
  const target = new WebGLRenderTarget(width, height, { samples: 4, encoding: sRGBEncoding });
  const pixels = new Uint8Array(width * height * 4);

  const background = scene.background;
  const fog = scene.fog;
  const clearColor = renderer.getClearColor(new Color());
  const clearAlpha = renderer.getClearAlpha();
  const clippingPlanes = renderer.clippingPlanes;
  const previousTarget = renderer.getRenderTarget();
  try {
    scene.background = null;
    scene.fog = null;
    renderer.setClearColor(0x1d2228, 1);
    // y <= cutHeight stays: the plane keeps the side its normal points to.
    renderer.clippingPlanes =
      request.cutHeight !== undefined ? [new Plane(new Vector3(0, -1, 0), request.cutHeight)] : [];
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.clippingPlanes = clippingPlanes;
    renderer.setClearColor(clearColor, clearAlpha);
    scene.background = background;
    scene.fog = fog;
    target.dispose();
    for (let i = restore.length - 1; i >= 0; i--) restore[i].object.visible = restore[i].visible;
  }

  // WebGL reads bottom-up; images are top-down.
  const image = new ImageData(width, height);
  const row = width * 4;
  for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  let blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
  if (blob.type !== "image/webp") blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return { blob, area };
}
