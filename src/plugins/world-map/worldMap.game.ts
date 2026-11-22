/** Buzzar (Third Room #461): positions for the world map, sent only while someone has it open (see worldMap.common). */
import { mat4 } from "gl-matrix";

import { GameContext } from "../../engine/GameTypes";
import { defineModule, getModule, registerMessageHandler, Thread } from "../../engine/module/module.common";
import { NetworkModule } from "../../engine/network/network.game";
import { ourPlayerQuery, playerQuery } from "../../engine/player/Player";
import { RemoteNode } from "../../engine/resource/RemoteResources";
import { tryGetRemoteResource } from "../../engine/resource/resource.game";
import { ThirdRoomModule } from "../thirdroom/thirdroom.game";
import {
  parseMapExtension,
  WorldMapEnableMessage,
  WorldMapFileMapMessage,
  WorldMapImage,
  WorldMapMessageType,
  WorldMapPlayer,
  WorldMapPositionsMessage,
} from "./worldMap.common";

interface WorldMapState {
  enabled: boolean;
  lastSent: number;
}

/** How often the dots move (ms): smooth enough for a map, and nothing at all while it's closed. */
const SEND_INTERVAL = 150;

export const WorldMapModule = defineModule<GameContext, WorldMapState>({
  name: "world-map",
  create: () => ({ enabled: false, lastSent: 0 }),
  init(ctx) {
    return registerMessageHandler(ctx, WorldMapMessageType.Enable, (ctx: GameContext, message: WorldMapEnableMessage) => {
      const state = getModule(ctx, WorldMapModule);
      state.enabled = message.enabled;
      state.lastSent = 0;
      if (message.enabled) {
        ctx.sendMessage<WorldMapFileMapMessage>(Thread.Main, { type: WorldMapMessageType.FileMap, map: fileMap(ctx) });
      }
    });
  },
});

/** The world file's own map picture (HAVEN_map), if it has one. */
export function fileMap(ctx: GameContext): WorldMapImage | undefined {
  const resource = getModule(ctx, ThirdRoomModule).environmentGLTFResource;
  const root = resource?.root as { extensions?: Record<string, unknown>; images?: any[]; bufferViews?: any[] };
  const ext = parseMapExtension(root?.extensions?.HAVEN_map);
  if (!resource || !ext) return undefined;
  const image = root.images?.[ext.image];
  if (!image) return undefined;
  try {
    if (image.uri) {
      const uri: string = resource.fileMap.get(image.uri) || image.uri;
      return { ...ext.area, url: new URL(uri, resource.baseUrl).toString() };
    }
    const view = root.bufferViews?.[image.bufferView];
    const buffer = view && resource.buffers.get(view.buffer);
    if (!view || !buffer || !image.mimeType) return undefined;
    // Copied out of the (shared) buffer: a Blob can't be made from a SharedArrayBuffer view.
    const bytes = new Uint8Array(view.byteLength);
    bytes.set(new Uint8Array(buffer, view.byteOffset ?? 0, view.byteLength));
    return { ...ext.area, blob: new Blob([bytes], { type: image.mimeType }) };
  } catch (error) {
    console.warn("HAVEN_map: couldn't read the map picture", error);
    return undefined;
  }
}

const _m = mat4.create();

export function WorldMapSystem(ctx: GameContext) {
  const state = getModule(ctx, WorldMapModule);
  if (!state.enabled) return;
  const now = performance.now();
  if (now - state.lastSent < SEND_INTERVAL) return;
  state.lastSent = now;

  const network = getModule(ctx, NetworkModule);
  const ours = ourPlayerQuery(ctx.world)[0];
  let self: WorldMapPositionsMessage["self"];
  const others: WorldMapPlayer[] = [];

  const players = playerQuery(ctx.world);
  for (let i = 0; i < players.length; i++) {
    const eid = players[i];
    const node = tryGetRemoteResource<RemoteNode>(ctx, eid);
    if (!node) continue;
    const m = node.worldMatrix;
    if (eid === ours) {
      // Facing: the camera's forward, or the body's if there's no camera.
      const camera = ctx.worldResource.activeCameraNode;
      const f = camera ? mat4.copy(_m, camera.worldMatrix) : m;
      self = { x: m[12], z: m[14], heading: Math.atan2(-f[8], f[10]) };
    } else {
      const peerId = network.entityIdToPeerId.get(eid);
      if (peerId) others.push({ peerId, x: m[12], z: m[14] });
    }
  }

  ctx.sendMessage<WorldMapPositionsMessage>(Thread.Main, { type: WorldMapMessageType.Positions, self, others });
}
