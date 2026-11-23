/**
 * Buzzar (Third Room #398): the game thread's part in screen sharing (screenShare.common.ts): the world's screens
 * (HAVEN_screen nodes) and where our player is looking, for the main thread to place shared screens.
 */
import { GameContext } from "../GameTypes";
import { defineModule, registerMessageHandler, Thread } from "../module/module.common";
import { ourPlayerQuery } from "../player/Player";
import { getCamera } from "../player/getCamera";
import { RemoteNode } from "../resource/RemoteResources";
import { getRemoteResource } from "../resource/resource.game";
import {
  ScreenQueryMessage,
  ScreenQueryResultMessage,
  ScreenShareMessageType,
  WorldScreen,
  yawOfMatrix,
} from "./screenShare.common";

/** HAVEN_screen: a place in the world where shared screens can be shown. */
export interface GLTFScreenExtension {
  /** The name people pick it by (defaults to the node's name). */
  name?: string;
  /** Width and height in the node's space (metres), centred on the node; defaults to its mesh's bounds (X × Y). */
  size?: [number, number];
}

interface ScreenNode {
  name: string;
  node: RemoteNode;
  width: number;
  height: number;
}

const screens: ScreenNode[] = [];

/** Called by the glTF loader for each HAVEN_screen node. */
export function addWorldScreen(node: RemoteNode, width: number, height: number, ext: GLTFScreenExtension) {
  const base = (typeof ext.name === "string" && ext.name.trim()) || node.name || "Screen";
  // Names must be unique: they're how a sharer picks one.
  let name = base;
  for (let i = 2; screens.some((screen) => screen.name === name); i++) name = `${base} ${i}`;
  screens.push({ name, node, width, height });
}

/** For a new world: forget the old one's screens. */
export function resetWorldScreens() {
  screens.length = 0;
}

function worldScreens(ctx: GameContext): WorldScreen[] {
  const result: WorldScreen[] = [];
  for (const screen of screens) {
    if (getRemoteResource(ctx, screen.node.eid) !== screen.node) continue;
    // A scaled node scales its screen too.
    const m = screen.node.worldMatrix;
    const scaleX = Math.hypot(m[0], m[1], m[2]);
    const scaleY = Math.hypot(m[4], m[5], m[6]);
    result.push({
      name: screen.name,
      matrix: Array.from(m),
      width: screen.width * scaleX,
      height: screen.height * scaleY,
    });
  }
  return result;
}

export const ScreenShareModule = defineModule<GameContext, {}>({
  name: "screen-share",
  create() {
    return {};
  },
  init(ctx) {
    return registerMessageHandler(ctx, ScreenShareMessageType.Query, (ctx, message: ScreenQueryMessage) => {
      const result: ScreenQueryResultMessage = {
        type: ScreenShareMessageType.QueryResult,
        requestId: message.requestId,
        screens: worldScreens(ctx),
      };
      const ourEid = ourPlayerQuery(ctx.world)[0];
      const rig = ourEid !== undefined ? getRemoteResource<RemoteNode>(ctx, ourEid) : undefined;
      if (rig) {
        let view: ArrayLike<number> = rig.worldMatrix;
        try {
          view = getCamera(ctx, rig).worldMatrix;
        } catch {
          // no camera (yet): the rig itself
        }
        result.eye = [view[12], view[13], view[14]];
        result.yaw = yawOfMatrix(view);
      }
      ctx.sendMessage<ScreenQueryResultMessage>(Thread.Main, result);
    });
  },
});
