/**
 * Buzzar: who you can hear in a world (voice.game.ts decides, the call follows: LiveKitCall only receives the voices
 * you can hear).
 *
 * - Voices are spatial and fade out with distance: full volume within a couple of metres, then quickly quieter, and
 *   silent past the world's voice range (`HAVEN_voice.range` on the scene, DEFAULT_VOICE_RANGE otherwise).
 * - Stage areas (`HAVEN_voice_zone` on a node, mode "broadcast"): someone standing in one is heard by everyone in the
 *   world at full volume, wherever they are. Like VRChat stages: the audience talks to the people around them, the
 *   performers reach the whole crowd.
 *
 * Each listener works this out from the positions it already receives, so everyone agrees without extra messages.
 */

/** Metres: past this, a voice is silent (and, in a LiveKit call, not received at all). VRChat's default too. */
export const DEFAULT_VOICE_RANGE = 25;
/** Full volume within this many metres. */
export const VOICE_NEAR = 2;
/** Keep receiving a voice this far past the range, so walking back and forth at the edge doesn't flap. */
export const VOICE_SUBSCRIBE_MARGIN = 5;
/**
 * The audio panner only gives voices their direction: their loudness is voiceRangeGain's curve, not the panner's
 * distance falloff (which never reaches silence: Third Room's carried speech across a whole world).
 */
export const VOICE_REF_DISTANCE = 1;
export const VOICE_ROLLOFF = 0;

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

/**
 * How loud a spatial voice is at `distance` metres: full within VOICE_NEAR, then falling off fast and reaching
 * silence at `range`, so groups a little way apart don't talk over each other. With the default 25 m: about 40% at
 * 10 m, 20% at 15 m, 6% at 20 m.
 */
export function voiceRangeGain(distance: number, range: number): number {
  if (distance <= VOICE_NEAR) return 1;
  if (distance >= range) return 0;
  const t = (distance - VOICE_NEAR) / (range - VOICE_NEAR);
  return (1 - t) * (1 - t);
}

export function clampVoiceRange(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(10000, Math.max(VOICE_NEAR + 3, value))
    : DEFAULT_VOICE_RANGE;
}
