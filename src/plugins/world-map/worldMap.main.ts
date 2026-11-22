/** Buzzar (Third Room #461): asks the render thread to draw the world map (see WorldMapCaptureSystem). */
import { MainContext } from "../../engine/MainThread";
import { registerMessageHandler, Thread } from "../../engine/module/module.common";
import {
  WorldMapArea,
  WorldMapGenerateMessage,
  WorldMapGeneratedMessage,
  WorldMapMessageType,
} from "./worldMap.common";

let nextId = 1;
/** Drawing compiles the world's materials for the capture: slow on big worlds, but never this slow. */
const TIMEOUT_MS = 60000;

export function generateWorldMap(ctx: MainContext, cutHeight?: number): Promise<{ blob: Blob; area: WorldMapArea }> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      dispose();
      reject(new Error("Drawing the map took too long."));
    }, TIMEOUT_MS);
    const dispose = registerMessageHandler(ctx, WorldMapMessageType.Generated, (_ctx, message: WorldMapGeneratedMessage) => {
      if (message.id !== id) return;
      clearTimeout(timeout);
      dispose();
      if (message.blob && message.area) resolve({ blob: message.blob, area: message.area });
      else reject(new Error(message.error ?? "Couldn't draw the map."));
    });
    ctx.sendMessage<WorldMapGenerateMessage>(Thread.Render, { type: WorldMapMessageType.Generate, id, cutHeight });
  });
}
