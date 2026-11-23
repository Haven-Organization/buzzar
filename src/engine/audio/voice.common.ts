/**
 * Buzzar: who you can hear in a world (voice.game.ts decides, the call follows: LiveKitCall only receives the voices
 * you can hear).
 *
 * - Voices are spatial and fade out with distance: full volume within a couple of metres, quieter further away, and
 *   silent past the world's voice range (`HAVEN_voice.range` on the scene, DEFAULT_VOICE_RANGE otherwise).
 * - Stage areas (`HAVEN_voice_zone` on a node, mode "broadcast"): someone standing in one is heard by everyone in the
 *   world at full volume, wherever they are. Like VRChat stages: the audience talks to the people around them, the
 *   performers reach the whole crowd.
 *
 * Each listener works this out from the positions it already receives, so everyone agrees without extra messages.
 */

/** Metres: past this, a voice is silent (and, in a LiveKit call, not received at all). */
export const DEFAULT_VOICE_RANGE = 30;
/** Metres over which a voice fades to silence at the edge of the range. */
export const VOICE_FADE = 5;
/** Keep receiving a voice this far past the range, so walking back and forth at the edge doesn't flap. */
export const VOICE_SUBSCRIBE_MARGIN = 5;
/** Volume falloff for spatial voices (Third Room #358: about a third at 10 m and a fifth at 20 m). */
export const VOICE_REF_DISTANCE = 2;
export const VOICE_ROLLOFF = 0.5;

export interface GLTFVoiceExtension {
  /** Metres beyond which voices are silent. */
  range?: number;
}

export interface GLTFVoiceZoneExtension {
  /** "broadcast": everyone in the world hears whoever stands here, at full volume. */
  mode?: "broadcast";
  /** Box size in the node's space [x, y, z] (centred on the node); defaults to the node's mesh bounds. */
  size?: [number, number, number];
}

export const VoiceAudibilityMessage = "voice-audibility";

/** Game → main: the people you can hear now (user IDs); sent when it changes. */
export interface VoiceAudibilityMessageType {
  type: typeof VoiceAudibilityMessage;
  audible: string[];
}

/** How loud a spatial voice is at `distance` metres, before the usual falloff: 1 inside the range, fading to 0. */
export function voiceRangeGain(distance: number, range: number): number {
  if (distance <= range - VOICE_FADE) return 1;
  if (distance >= range) return 0;
  return (range - distance) / VOICE_FADE;
}

export function clampVoiceRange(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(10000, Math.max(VOICE_FADE + 1, value))
    : DEFAULT_VOICE_RANGE;
}
