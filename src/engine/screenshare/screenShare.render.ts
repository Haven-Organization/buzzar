/**
 * Buzzar (Third Room #398): draws shared screens (screenShare.common.ts). Each is a panel in the scene showing the
 * newest picture the main thread sent, fitted to its space with the picture's own aspect ratio, dark from behind.
 */
import {
  BackSide,
  Color,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  sRGBEncoding,
  Texture,
  LinearFilter,
} from "three";

import { defineModule, getModule, registerMessageHandler } from "../module/module.common";
import { RendererModule, RenderContext } from "../renderer/renderer.render";
import { createDisposables } from "../utils/createDisposables";
import {
  fitScreen,
  ScreenFrameMessage,
  ScreenHideMessage,
  ScreenShareMessageType,
  ScreenShowMessage,
} from "./screenShare.common";

interface ShownScreen {
  group: Group;
  picture: Mesh;
  back: Mesh;
  texture: Texture;
  width: number;
  height: number;
  bitmap?: ImageBitmap;
}

const plane = new PlaneGeometry(1, 1);
const backMaterial = new MeshBasicMaterial({ color: new Color(0x111114), side: BackSide });
/** Shown until the first picture arrives. */
const waitingColor = new Color(0x202024);

function fit(screen: ShownScreen) {
  const image = screen.bitmap;
  const aspect = image ? image.width / image.height : 16 / 9;
  const [w, h] = fitScreen(screen.width, screen.height, aspect);
  screen.picture.scale.set(w, h, 1);
  screen.back.scale.set(w, h, 1);
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
      (screen.picture.material as MeshBasicMaterial).dispose();
      screen.bitmap?.close();
    };

    return createDisposables([
      registerMessageHandler(ctx, ScreenShareMessageType.Show, (ctx, message: ScreenShowMessage) => {
        let screen = screens.get(message.id);
        if (!screen) {
          const texture = new Texture();
          texture.encoding = sRGBEncoding;
          texture.minFilter = LinearFilter;
          texture.generateMipmaps = false;
          const material = new MeshBasicMaterial({ color: waitingColor, side: FrontSide, toneMapped: false });
          const picture = new Mesh(plane, material);
          const back = new Mesh(plane, backMaterial);
          const group = new Group();
          group.matrixAutoUpdate = false;
          group.add(picture, back);
          getModule(ctx, RendererModule).scene.add(group);
          screen = { group, picture, back, texture, width: message.width, height: message.height };
          screens.set(message.id, screen);
        }
        screen.width = message.width;
        screen.height = message.height;
        // A hair in front of the world's own screen surface, so the picture covers it.
        screen.group.matrix.fromArray(message.matrix).multiply(new Matrix4().makeTranslation(0, 0, 0.01));
        screen.group.matrixWorldNeedsUpdate = true;
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
        if (resized) {
          // A new size needs a new GPU texture.
          screen.texture.dispose();
        }
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
