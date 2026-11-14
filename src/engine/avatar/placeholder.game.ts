/**
 * Buzzar: loading placeholder shown in place of a player while their avatar is being looked up, downloaded or
 * prepared (on join and on every avatar switch).
 *
 * A glowing, spinning blue diamond with an orbiting ring, plus a camera-facing panel showing what is loading,
 * a progress bar and the current stage. Inspired by the "loading avatar" convention in VRChat, but our own
 * design.
 */
import { quat } from "gl-matrix";
import { SphereGeometry, TorusGeometry } from "three";

import { getYaw } from "../common/math";
import { addChild, removeChild } from "../component/transform";
import { GameContext } from "../GameTypes";
import { createMesh } from "../mesh/mesh.game";
import { isAvatarHiddenFromMainCamera, setAvatarHiddenFromMainCamera } from "../player/avatarLayers";
import { AvatarRef } from "../player/components";
import { RemoteMaterial, RemoteNode, RemoteUICanvas, RemoteUIElement, RemoteUIText } from "../resource/RemoteResources";
import { getRemoteResource } from "../resource/resource.game";
import { ElementType, FlexDirection, MaterialAlphaMode, MaterialType } from "../resource/schema";
import { addUIElementChild } from "../ui/ui.game";

const DIAMOND_HEIGHT = 1.0;
const PANEL_HEIGHT = 1.55;
const PANEL_PIXELS: [number, number] = [440, 120];
const PANEL_SIZE: [number, number] = [0.73, 0.2];
const BAR_WIDTH = 410;
/** Keep the placeholder up at least this long so quick (cached) switches are still visible. */
const MIN_DISPLAY_MS = 1000;

interface Placeholder {
  container: RemoteNode;
  root: RemoteNode;
  diamond: RemoteNode;
  ring: RemoteNode;
  panel: RemoteNode;
  canvas: RemoteUICanvas;
  title: RemoteUIText;
  status: RemoteUIText;
  fill: RemoteUIElement;
  hiddenRig?: RemoteNode;
  hiddenFromMainCamera: boolean;
  shownAt: number;
  hideAt?: number;
}

const placeholders = new Map<RemoteNode, Placeholder>();

export function isAvatarLoading(container: RemoteNode): boolean {
  return placeholders.has(container);
}

function text(
  ctx: GameContext,
  value: string,
  fontSize: number,
  color: [number, number, number, number],
  weight = "normal"
) {
  const uiText = new RemoteUIText(ctx.resourceManager, { value, fontSize, fontWeight: weight, color });
  const element = new RemoteUIElement(ctx.resourceManager, { type: ElementType.Text, text: uiText });
  return { element, uiText };
}

function glowMaterial(ctx: GameContext, color: [number, number, number], alpha: number) {
  return new RemoteMaterial(ctx.resourceManager, {
    type: MaterialType.Standard,
    baseColorFactor: [color[0], color[1], color[2], alpha],
    emissiveFactor: color,
    metallicFactor: 0,
    roughnessFactor: 0.25,
    alphaMode: alpha < 1 ? MaterialAlphaMode.BLEND : MaterialAlphaMode.OPAQUE,
  });
}

/** Shows (or retitles) the placeholder for a player container and hides their current avatar. */
export function showAvatarPlaceholder(ctx: GameContext, container: RemoteNode, title: string) {
  const existing = placeholders.get(container);
  if (existing) {
    existing.title.value = title;
    existing.hideAt = undefined;
    existing.canvas.redraw++;
    return;
  }

  const root = new RemoteNode(ctx.resourceManager, { name: "Avatar Loading Placeholder" });

  const diamond = new RemoteNode(ctx.resourceManager, {
    name: "Loading Diamond",
    position: [0, DIAMOND_HEIGHT, 0],
    scale: [1, 1.45, 1],
    // A 4×2-segment sphere is an octahedron, and indexed (createMesh needs an index; OctahedronGeometry isn't).
    mesh: createMesh(ctx, new SphereGeometry(0.2, 4, 2), glowMaterial(ctx, [0.25, 0.6, 1], 0.92)),
  });
  const ring = new RemoteNode(ctx.resourceManager, {
    name: "Loading Ring",
    position: [0, DIAMOND_HEIGHT, 0],
    mesh: createMesh(ctx, new TorusGeometry(0.4, 0.012, 8, 64), glowMaterial(ctx, [0.55, 0.85, 1], 1)),
  });

  // Panel: title, progress bar, status line.
  const [width, height] = PANEL_PIXELS;
  const rootElement = new RemoteUIElement(ctx.resourceManager, {
    width,
    height,
    flexDirection: FlexDirection.Column,
    padding: [12, 15, 12, 15],
    backgroundColor: [0.04, 0.06, 0.12, 0.9],
    borderRadius: [14, 14, 14, 14],
  });
  const titleText = text(ctx, title, 26, [1, 1, 1, 1], "bold");
  titleText.element.margin.set([0, 0, 8, 0]);
  const bar = new RemoteUIElement(ctx.resourceManager, {
    width: BAR_WIDTH,
    height: 12,
    backgroundColor: [0.18, 0.22, 0.32, 1],
    borderRadius: [6, 6, 6, 6],
    margin: [0, 0, 8, 0],
  });
  const fill = new RemoteUIElement(ctx.resourceManager, {
    width: 0,
    height: 12,
    backgroundColor: [0.3, 0.65, 1, 1],
    borderRadius: [6, 6, 6, 6],
  });
  const statusText = text(ctx, "Looking up avatar…", 18, [0.75, 0.82, 0.95, 1]);
  addUIElementChild(bar, fill);
  addUIElementChild(rootElement, titleText.element);
  addUIElementChild(rootElement, bar);
  addUIElementChild(rootElement, statusText.element);

  const canvas = new RemoteUICanvas(ctx.resourceManager, { root: rootElement, size: PANEL_SIZE, width, height });
  const panel = new RemoteNode(ctx.resourceManager, {
    name: "Loading Panel",
    position: [0, PANEL_HEIGHT, 0],
    uiCanvas: canvas,
  });

  addChild(root, diamond);
  addChild(root, ring);
  addChild(root, panel);
  addChild(container, root);

  // Hide the current avatar while loading; show the placeholder wherever the avatar would be visible.
  const rig = getRemoteResource<RemoteNode>(ctx, AvatarRef.eid[container.eid]);
  const hidden = rig ? isAvatarHiddenFromMainCamera(rig) : false;
  setAvatarHiddenFromMainCamera(root, hidden);
  if (rig) rig.visible = false;

  placeholders.set(container, {
    container,
    root,
    diamond,
    ring,
    panel,
    canvas,
    title: titleText.uiText,
    status: statusText.uiText,
    fill,
    hiddenRig: rig,
    hiddenFromMainCamera: hidden,
    shownAt: performance.now(),
  });
}

/** @param progress 0..1, or undefined for an indeterminate stage. */
export function setAvatarPlaceholderProgress(container: RemoteNode, progress: number | undefined, status: string) {
  const placeholder = placeholders.get(container);
  if (!placeholder) return;
  placeholder.fill.width = progress === undefined ? 0 : Math.round(BAR_WIDTH * Math.min(Math.max(progress, 0), 1));
  placeholder.status.value = status;
  placeholder.canvas.redraw++;
}

/** Removes the placeholder now, or after `delayMs` (e.g. to leave an error message readable). */
export function hideAvatarPlaceholder(ctx: GameContext, container: RemoteNode, delayMs = 0) {
  const placeholder = placeholders.get(container);
  if (!placeholder) return;
  const now = performance.now();
  const earliest = placeholder.shownAt + MIN_DISPLAY_MS;
  if (delayMs > 0 || now < earliest) {
    placeholder.hideAt = Math.max(now + delayMs, earliest);
    return;
  }
  removePlaceholder(ctx, container, placeholder);
}

/**
 * Show the placeholder for a change that hasn't been confirmed yet (e.g. we just pressed a pedestal and the
 * choice is being saved to Matrix). It goes away on its own after `timeoutMs` unless a real load takes over.
 */
export function showPendingAvatarPlaceholder(
  ctx: GameContext,
  container: RemoteNode,
  title: string,
  status: string,
  timeoutMs: number
) {
  showAvatarPlaceholder(ctx, container, title);
  setAvatarPlaceholderProgress(container, undefined, status);
  const placeholder = placeholders.get(container);
  if (placeholder) placeholder.hideAt = performance.now() + timeoutMs;
}

function removePlaceholder(ctx: GameContext, container: RemoteNode, placeholder: Placeholder) {
  placeholders.delete(container);

  if (getRemoteResource(ctx, container.eid) === container) {
    removeChild(container, placeholder.root);
    // Restore whichever avatar is current now (the new one after a swap, or the old one on failure).
    const rig = getRemoteResource<RemoteNode>(ctx, AvatarRef.eid[container.eid]);
    if (rig) rig.visible = true;
  }
}

/** Keeps the new rig hidden if a swap happens while the placeholder is still up. */
export function hideRigWhileLoading(container: RemoteNode, rig: RemoteNode) {
  if (placeholders.has(container)) rig.visible = false;
}

const _yawQuat = quat.create();

export function AvatarPlaceholderSystem(ctx: GameContext) {
  if (placeholders.size === 0) return;

  const now = performance.now();
  const t = now / 1000;
  const camera = ctx.worldResource.activeCameraNode;

  for (const placeholder of [...placeholders.values()]) {
    const { container } = placeholder;
    if (getRemoteResource(ctx, container.eid) !== container) {
      placeholders.delete(container);
      continue;
    }
    if (placeholder.hideAt !== undefined && now >= placeholder.hideAt) {
      removePlaceholder(ctx, container, placeholder);
      continue;
    }

    // Follow the avatar's first-person visibility (it can change after the placeholder appears, e.g. when our own
    // player is embodied), so our own placeholder only shows in mirrors.
    const rig = getRemoteResource<RemoteNode>(ctx, AvatarRef.eid[container.eid]);
    const hidden = rig ? isAvatarHiddenFromMainCamera(rig) : false;
    if (hidden !== placeholder.hiddenFromMainCamera) {
      placeholder.hiddenFromMainCamera = hidden;
      setAvatarHiddenFromMainCamera(placeholder.root, hidden);
    }

    // Spin the diamond, orbit/tilt the ring, bob both gently.
    const bob = Math.sin(t * 2) * 0.03;
    quat.fromEuler(placeholder.diamond.quaternion, 0, (t * 90) % 360, 0);
    quat.fromEuler(placeholder.ring.quaternion, 90 + Math.sin(t * 1.3) * 15, 0, (t * -60) % 360);
    placeholder.diamond.position[1] = DIAMOND_HEIGHT + bob;
    placeholder.ring.position[1] = DIAMOND_HEIGHT + bob;

    // Turn the panel to face the camera (yaw only). UI canvases face their local +Z.
    if (camera) {
      const cx = camera.worldMatrix[12];
      const cz = camera.worldMatrix[14];
      const px = container.worldMatrix[12];
      const pz = container.worldMatrix[14];
      const worldYaw = Math.atan2(cx - px, cz - pz);
      const containerYaw = getYaw(container.quaternion);
      quat.setAxisAngle(_yawQuat, [0, 1, 0], worldYaw - containerYaw);
      quat.copy(placeholder.panel.quaternion, _yawQuat);
    }
  }
}
