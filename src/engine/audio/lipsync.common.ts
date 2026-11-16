/** Buzzar: lip sync messages shared by the main thread (analysis, lipsync.main.ts) and the game thread (faces). */
import type { GameContext } from "../GameTypes";

export const LipSyncMessageType = "software.haven.lipsync";

/** Order of the values in each frame: */
export const VISEMES = ["aa", "ih", "ou", "ee", "oh"] as const;
export type VisemeName = (typeof VISEMES)[number];

/** Key used for your own microphone (the game maps it to your avatar). */
export const LOCAL_VOICE = "";

export interface LipSyncMessage {
  type: typeof LipSyncMessageType;
  /** peerId → the five viseme weights (0–1), only for voices that changed since the last message. */
  voices: [string, number[]][];
}

/** Game thread: latest viseme weights per voice. */
export const lipSyncVoices = new Map<string, Float32Array>();

export function onLipSyncMessage(_ctx: GameContext, message: LipSyncMessage) {
  for (const [key, values] of message.voices) {
    let v = lipSyncVoices.get(key);
    if (!v) lipSyncVoices.set(key, (v = new Float32Array(VISEMES.length)));
    v.set(values);
  }
}
