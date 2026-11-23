/**
 * Buzzar (Third Room #398): draws shared screens (screenShare.common.ts). Each is a panel in the scene showing the
 * newest picture the main thread sent, fitted to its space with the picture's own aspect ratio. Its back says whose
 * screen it is ("… is sharing their screen"), so someone behind it knows what it is. A floating screen stands on a
 * handle bar (its sharer can grab it: plugins/screen-share); someone else's screen glides between the places its
 * sharer sends, a few times a second.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  FrontSide,
  Group,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  sRGBEncoding,
  Texture,
  Vector3,
} from "three";

import { defineModule, getModule, registerMessageHandler } from "../module/module.common";
import { RendererModule, RenderContext } from "../renderer/renderer.render";
import { createDisposables } from "../utils/createDisposables";
import {
  fitScreen,
  HANDLE_GAP,
  ScreenFrameMessage,
  ScreenHideMessage,
  ScreenShareMessageType,
  ScreenShowMessage,
} from "./screenShare.common";

interface ShownScreen {
  group: Group;
  /** Picture and back, positioned together above the handle (or centred). */
  panel: Group;
  picture: Mesh;
  back: Mesh;
  backTexture?: CanvasTexture;
  /** The label and shape the back was last drawn for. */
  backKey?: string;
  label: string;
  handle?: Mesh;
  texture: Texture;
  width: number;
  height: number;
  anchor: "center" | "bottom";
  bitmap?: ImageBitmap;
  /** Where it's heading (smooth screens). */
  target?: { position: Vector3; rotation: Quaternion };
}

const plane = new PlaneGeometry(1, 1);
const handleGeometry = new BoxGeometry(0.4, 0.05, 0.05);
const handleMaterial = new MeshBasicMaterial({ color: new Color(0xb8bcc8) });
/** Shown until the first picture arrives. */
const waitingColor = new Color(0x202024);
/** How quickly a smooth screen catches up with its latest place (per second). */
const GLIDE_RATE = 12;

function fit(screen: ShownScreen) {
  const image = screen.bitmap;
  const aspect = image ? image.width / image.height : 16 / 9;
  const [w, h] = fitScreen(screen.width, screen.height, aspect);
  screen.picture.scale.set(w, h, 1);
  screen.back.scale.set(w, h, 1);
  screen.panel.position.set(0, screen.anchor === "bottom" ? h / 2 + HANDLE_GAP : 0, 0);
  drawBack(screen, w / h);
}

/** The back: dark, with "<name> is sharing their screen" in the middle. */
function drawBack(screen: ShownScreen, aspect: number) {
  if (typeof OffscreenCanvas === "undefined") return;
  const height = 256;
  const width = Math.max(256, Math.min(2048, Math.round(height * aspect)));
  const key = `${screen.label}|${width}`;
  if (screen.backKey === key) return;
  screen.backKey = key;
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext("2d");
  if (!g) return;
  g.fillStyle = "#16161b";
  g.fillRect(0, 0, width, height);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const line = (text: string, size: number, weight: string, color: string, y: number) => {
    let px = size;
    do {
      g.font = `${weight} ${px}px sans-serif`;
      px -= 2;
    } while (g.measureText(text).width > width * 0.9 && px > 10);
    g.fillStyle = color;
    g.fillText(text, width / 2, y);
  };
  line(screen.label, 44, "bold", "#e8e8ee", height * 0.4);
  line("is sharing their screen on the other side", 28, "normal", "#a8a8b4", height * 0.62);
  screen.backTexture?.dispose();
  const texture = new CanvasTexture(canvas as unknown as HTMLCanvasElement);
  texture.encoding = sRGBEncoding;
  screen.backTexture = texture;
  const material = screen.back.material as MeshBasicMaterial;
  material.map = texture;
  material.color.set(0xffffff);
  material.needsUpdate = true;
}

const _matrix = new Matrix4();
const _position = new Vector3();
const _rotation = new Quaternion();
const _scale = new Vector3();
const ONE = new Vector3(1, 1, 1);
/** A hair in front of the given surface, so a picture on a world's screen covers that screen's own surface. */
const _offset = new Matrix4().makeTranslation(0, 0, 0.01);

function place(screen: ShownScreen) {
  screen.group.matrix.compose(screen.group.position, screen.group.quaternion, ONE);
  screen.group.matrixWorldNeedsUpdate = true;
}

export const ScreenShareRenderModule = defineModule<RenderContext, { screens: Map<string, ShownScreen> }>({
  name: "screen-share-render",
  create() {
    return { screens: new Map() };
  },
  init(ctx) {
    const { screens } = getModule(ctx, ScreenShareRenderModule);
    const hide = (id: string) => {
      const screen = screens.get(id);
      if (!screen) return;
      screens.delete(id);
      screen.group.parent?.remove(screen.group);
      screen.texture.dispose();
      screen.backTexture?.dispose();
      (screen.picture.material as MeshBasicMaterial).dispose();
      (screen.back.material as MeshBasicMaterial).dispose();
      screen.bitmap?.close();
    };

    return createDisposables([
      registerMessageHandler(ctx, ScreenShareMessageType.Show, (ctx, message: ScreenShowMessage) => {
        let screen = screens.get(message.id);
        const fresh = !screen;
        if (!screen) {
          const texture = new Texture();
          texture.encoding = sRGBEncoding;
          texture.minFilter = LinearFilter;
          texture.generateMipmaps = false;
          // WebGL ignores flipY for ImageBitmaps, so the picture came out upside down: flip it in the UVs instead.
          texture.flipY = false;
          texture.repeat.set(1, -1);
          texture.offset.set(0, 1);
          const picture = new Mesh(
            plane,
            new MeshBasicMaterial({ color: waitingColor, side: FrontSide, toneMapped: false })
          );
          // The back faces the other way (-Z).
          const back = new Mesh(plane, new MeshBasicMaterial({ color: waitingColor, side: FrontSide }));
          back.rotation.y = Math.PI;
          const panel = new Group();
          panel.add(picture, back);
          const group = new Group();
          group.matrixAutoUpdate = false;
          group.add(panel);
          getModule(ctx, RendererModule).scene.add(group);
          screen = {
            group,
            panel,
            picture,
            back,
            label: message.label,
            texture,
            width: message.width,
            height: message.height,
            anchor: message.anchor,
          };
          screens.set(message.id, screen);
        }
        screen.width = message.width;
        screen.height = message.height;
        screen.anchor = message.anchor;
        screen.label = message.label;

        if (message.handle && !screen.handle) {
          screen.handle = new Mesh(handleGeometry, handleMaterial);
          screen.group.add(screen.handle);
        } else if (!message.handle && screen.handle) {
          screen.group.remove(screen.handle);
          screen.handle = undefined;
        }

        _matrix.fromArray(message.matrix).multiply(_offset);
        _matrix.decompose(_position, _rotation, _scale);
        if (message.smooth && !fresh) {
          screen.target = { position: _position.clone(), rotation: _rotation.clone() };
        } else {
          screen.target = undefined;
          screen.group.position.copy(_position);
          screen.group.quaternion.copy(_rotation);
          place(screen);
        }
        fit(screen);
      }),
      registerMessageHandler(ctx, ScreenShareMessageType.Frame, (_ctx, message: ScreenFrameMessage) => {
        const screen = screens.get(message.id);
        if (!screen) {
          message.bitmap.close();
          return;
        }
        const old = screen.bitmap;
        const resized = !old || old.width !== message.bitmap.width || old.height !== message.bitmap.height;
        screen.bitmap = message.bitmap;
        // A new size needs a new GPU texture.
        if (resized) screen.texture.dispose();
        screen.texture.image = message.bitmap;
        screen.texture.needsUpdate = true;
        const material = screen.picture.material as MeshBasicMaterial;
        if (material.map !== screen.texture) {
          material.map = screen.texture;
          material.color.set(0xffffff);
          material.needsUpdate = true;
        }
        if (resized) fit(screen);
        // Uploaded on the next draw; the one before is no longer needed.
        old?.close();
      }),
      registerMessageHandler(ctx, ScreenShareMessageType.Hide, (_ctx, message: ScreenHideMessage) => hide(message.id)),
      () => {
        for (const id of Array.from(screens.keys())) hide(id);
      },
    ]);
  },
});

/** Glides screens towards their latest place. */
export function ScreenShareRenderSystem(ctx: RenderContext) {
  const { screens } = getModule(ctx, ScreenShareRenderModule);
  if (screens.size === 0) return;
  const t = 1 - Math.exp(-GLIDE_RATE * Math.min(ctx.dt, 0.25));
  screens.forEach((screen) => {
    const target = screen.target;
    if (!target) return;
    screen.group.position.lerp(target.position, t);
    screen.group.quaternion.slerp(target.rotation, t);
    place(screen);
    const arrived =
      screen.group.position.distanceToSquared(target.position) < 1e-8 &&
      screen.group.quaternion.angleTo(target.rotation) < 1e-4;
    if (arrived) screen.target = undefined;
  });
}
