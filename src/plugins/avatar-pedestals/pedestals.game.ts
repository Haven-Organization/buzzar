/**
 * Buzzar avatar pedestals (glTF node extension `HAVEN_avatar_pedestal`), like VRChat's avatar pedestals.
 *
 * The pedestal node marks the spot an avatar stands on (top of the podium), facing +Z. Buzzar adds:
 * - a live, idle-animated 3D preview of the avatar (scaled to `previewHeight`), and/or a picture,
 * - an info panel with the name, author, license and description,
 * - a clickable stand: pressing it switches *your* avatar in this world (handled on the main thread by
 *   updating your own member event, see src/engine/avatar/avatar.main.ts).
 *
 * Avatar URIs must be `mxc://` (Matrix worlds) or relative to the glTF file (local files / dev viewer).
 * Arbitrary http(s) URLs are refused so a world can't make visitors fetch from third-party servers.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { vec3 } from "gl-matrix";

import {
  AvatarPedestalSelectedMessage,
  AvatarPedestalSelectedMessageType,
  getBuiltinAvatarByUri,
  MediaConfigMessage,
  MediaConfigMessageType,
  mxcToHttp,
} from "../../engine/avatar/avatar.common";
import { AvatarRejectedError, getAppliedAvatarUrl, loadAvatarRig } from "../../engine/avatar/avatar.game";
import { showPendingAvatarPlaceholder } from "../../engine/avatar/placeholder.game";
import { ourPlayerQuery } from "../../engine/player/Player";
import { addChild, updateMatrixWorld } from "../../engine/component/transform";
import { GameContext } from "../../engine/GameTypes";
import { defineModule, getModule, registerMessageHandler, Thread } from "../../engine/module/module.common";
import { addPhysicsBody, addPhysicsCollider, PhysicsModule } from "../../engine/physics/physics.game";
import {
  RemoteCollider,
  RemoteImage,
  RemoteNode,
  RemotePhysicsBody,
  RemoteUICanvas,
  RemoteUIElement,
  RemoteUIImage,
  RemoteUIText,
} from "../../engine/resource/RemoteResources";
import { getRemoteResource } from "../../engine/resource/resource.game";
import {
  ColliderType,
  ElementType,
  FlexDirection,
  InteractableType,
  PhysicsBodyType,
} from "../../engine/resource/schema";
import { addUIElementChild } from "../../engine/ui/ui.game";
import { addInteractableComponent } from "../interaction/interaction.game";

/** glTF node extension `HAVEN_avatar_pedestal`. */
export interface GLTFAvatarPedestalExtension {
  avatar?: {
    /** mxc:// URI or path relative to the glTF. Omit for the built-in default avatar. */
    uri?: string;
    name?: string;
    author?: string;
    license?: string;
    description?: string;
  };
  /** What to show: a live 3D model (default), only the picture, or nothing but the panel. */
  preview?: "model" | "image" | "none";
  /** glTF image index for a picture shown on the info panel. */
  image?: number;
  /** Height of the 3D preview in metres. Default 1.2. */
  previewHeight?: number;
}

interface PedestalState {
  stand: RemoteNode;
  uri?: string;
  url?: string;
  name: string;
}

interface PedestalModuleState {
  homeserver?: string;
  pedestals: PedestalState[];
}

export const AvatarPedestalModule = defineModule<GameContext, PedestalModuleState>({
  name: "avatar-pedestals",
  create() {
    return { pedestals: [] };
  },
  init(ctx) {
    return registerMessageHandler(ctx, MediaConfigMessage, (ctx: GameContext, message: MediaConfigMessageType) => {
      getModule(ctx, AvatarPedestalModule).homeserver = message.homeserver;
    });
  },
});

/** Resolves a world-supplied avatar URI to a loadable URL, or undefined if it isn't allowed. */
export function resolvePedestalUri(uri: string, gltfUrl: string, homeserver?: string): string | undefined {
  if (uri.startsWith("mxc://")) return homeserver ? mxcToHttp(uri, homeserver) : undefined;
  const builtin = getBuiltinAvatarByUri(uri);
  if (builtin) return new URL(builtin.path, self.location.origin).href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return undefined; // any other absolute URI (http:, data:, javascript:…)
  try {
    const base = new URL(gltfUrl);
    const resolved = new URL(uri, base);
    // Relative paths stay with the world file (same origin, or inside the same blob/file map).
    return resolved.origin === base.origin ? resolved.href : undefined;
  } catch {
    return undefined;
  }
}

const DEFAULT_PREVIEW_HEIGHT = 1.2;
const PANEL_SIZE: [number, number] = [0.9, 0.5];
const PANEL_GAP = 0.2;
const PANEL_PIXELS: [number, number] = [540, 300];

export function addAvatarPedestal(
  ctx: GameContext,
  node: RemoteNode,
  extension: GLTFAvatarPedestalExtension,
  gltfUrl: string,
  image?: RemoteImage
) {
  const module = getModule(ctx, AvatarPedestalModule);
  const physics = getModule(ctx, PhysicsModule);
  const info = extension.avatar ?? {};
  const name = info.name ?? (info.uri ? "Avatar" : "Default Avatar");
  const previewHeight = extension.previewHeight ?? DEFAULT_PREVIEW_HEIGHT;
  const url = info.uri ? resolvePedestalUri(info.uri, gltfUrl, module.homeserver) : undefined;
  const panelY = previewHeight + PANEL_GAP + PANEL_SIZE[1] / 2;
  const clickableHeight = panelY + PANEL_SIZE[1] / 2;

  // Clickable stand the avatar preview stands in.
  // Avatar rigs face -Z (the player's forward); turn the stand so the preview faces the pedestal's +Z.
  const stand = new RemoteNode(ctx.resourceManager, { name: `Wear "${name}"`, quaternion: [0, 1, 0, 0] });
  // Attach first: physics bodies take their world transform when created.
  addChild(node, stand);
  updateMatrixWorld(stand);

  addPhysicsCollider(
    ctx.world,
    stand,
    new RemoteCollider(ctx.resourceManager, {
      type: ColliderType.Box,
      // Covers the avatar preview *and* its info panel: the whole pedestal is clickable, like VRChat.
      size: [PANEL_SIZE[0], clickableHeight, 0.7],
      offset: [0, clickableHeight / 2, 0],
      activeEvents: RAPIER.ActiveEvents.COLLISION_EVENTS,
      // A sensor: clickable, but players can still walk or jump onto the podium. As a solid box it pushed
      // anyone standing on the podium back off.
      isTrigger: true,
    })
  );
  addPhysicsBody(
    ctx.world,
    physics,
    stand,
    new RemotePhysicsBody(ctx.resourceManager, { type: PhysicsBodyType.Static })
  );
  addInteractableComponent(ctx, physics, stand, InteractableType.Interactable);

  module.pedestals.push({ stand, uri: info.uri, url, name });

  addInfoPanel(ctx, node, panelY, name, info, image, extension.preview === "image");

  if (info.uri && !url) {
    console.warn(`Avatar pedestal "${name}": unsupported avatar URI ${info.uri}`);
    return;
  }

  if ((extension.preview ?? "model") === "model") {
    loadAvatarRig(ctx, url)
      .then(({ rig, eyeHeight }) => {
        if (getRemoteResource(ctx, stand.eid) !== stand) return; // world unloaded meanwhile
        const scale = previewHeight / ((eyeHeight ?? 1.64) + 0.12);
        vec3.scale(rig.scale, rig.scale, scale);
        addChild(stand, rig);
      })
      .catch((error) => {
        const reason = error instanceof AvatarRejectedError ? error.message : String(error);
        console.warn(`Avatar pedestal "${name}": preview unavailable (${reason})`);
      });
  }
}

function text(
  ctx: GameContext,
  value: string,
  fontSize: number,
  color: [number, number, number, number],
  weight = "normal"
) {
  return new RemoteUIElement(ctx.resourceManager, {
    type: ElementType.Text,
    text: new RemoteUIText(ctx.resourceManager, { value, fontSize, fontWeight: weight, color }),
    margin: [0, 0, 6, 0],
  });
}

function addInfoPanel(
  ctx: GameContext,
  node: RemoteNode,
  panelY: number,
  name: string,
  info: NonNullable<GLTFAvatarPedestalExtension["avatar"]>,
  image: RemoteImage | undefined,
  largeImage: boolean
) {
  const [width, height] = PANEL_PIXELS;
  const root = new RemoteUIElement(ctx.resourceManager, {
    width,
    height,
    flexDirection: FlexDirection.Row,
    padding: [18, 18, 18, 18],
    backgroundColor: [0.08, 0.08, 0.1, 0.97],
    borderRadius: [16, 16, 16, 16],
  });

  if (image) {
    const size = largeImage ? 264 : 160;
    addUIElementChild(
      root,
      new RemoteUIElement(ctx.resourceManager, {
        type: ElementType.Image,
        width: size,
        height: size,
        margin: [0, 18, 0, 0],
        image: new RemoteUIImage(ctx.resourceManager, { source: image, alt: name }),
      })
    );
  }

  const column = new RemoteUIElement(ctx.resourceManager, { flexDirection: FlexDirection.Column, flexGrow: 1 });
  addUIElementChild(root, column);
  addUIElementChild(column, text(ctx, name, 40, [1, 1, 1, 1], "bold"));
  if (info.author) addUIElementChild(column, text(ctx, `by ${info.author}`, 24, [0.8, 0.8, 0.85, 1]));
  if (info.license) addUIElementChild(column, text(ctx, `License: ${info.license}`, 20, [0.7, 0.7, 0.75, 1]));
  if (info.description) addUIElementChild(column, text(ctx, info.description, 20, [0.85, 0.85, 0.9, 1]));
  addUIElementChild(column, text(ctx, "Click the avatar to wear it", 20, [0.55, 0.8, 1, 1], "bold"));

  const panel = new RemoteNode(ctx.resourceManager, {
    name: `${name} info`,
    position: [0, panelY, 0],
    uiCanvas: new RemoteUICanvas(ctx.resourceManager, { root, size: PANEL_SIZE, width, height }),
  });
  addChild(node, panel);
}

export function AvatarPedestalSystem(ctx: GameContext) {
  const module = getModule(ctx, AvatarPedestalModule);

  for (let i = module.pedestals.length - 1; i >= 0; i--) {
    const pedestal = module.pedestals[i];
    if (getRemoteResource(ctx, pedestal.stand.eid) !== pedestal.stand) {
      module.pedestals.splice(i, 1);
      continue;
    }
    if (!pedestal.stand.interactable?.pressed) continue;

    // Immediate feedback on ourselves while the choice is saved to Matrix and read back (≈1 s); the real
    // download/preparing progress takes over once it's confirmed.
    const ourEid = ourPlayerQuery(ctx.world)[0];
    const ourContainer = ourEid ? getRemoteResource<RemoteNode>(ctx, ourEid) : undefined;
    if (ourContainer && getAppliedAvatarUrl(ctx, ourContainer) !== pedestal.url) {
      showPendingAvatarPlaceholder(ctx, ourContainer, `Switching to ${pedestal.name}`, "Saving your choice…", 15_000);
    }

    ctx.sendMessage<AvatarPedestalSelectedMessageType>(Thread.Main, {
      type: AvatarPedestalSelectedMessage,
      uri: pedestal.uri,
      url: pedestal.url,
      name: pedestal.name,
    });
  }
}
