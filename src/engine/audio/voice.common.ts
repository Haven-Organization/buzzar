/**
 * Buzzar: how loud each player's voice is for you (voice.game.ts decides, the call follows: a LiveKit call only
 * receives the voices you can hear). Modelled on VRChat's per-player voice settings (Udon "Player Audio": gain, near,
 * far, low-pass), whose defaults it follows where they're documented:
 *
 * - far: past this many metres a voice is silent (VRChat's default 25 m). A world sets it with `HAVEN_voice.range`.
 * - near: full volume within this many metres, falling off from there (VRChat recommends 0, the default).
 * - low-pass: distant voices are muffled, which helps pick out nearby speech in a busy world (on by default; a world
 *   can turn it off, e.g. for a DJ).
 * - gain: in decibels, relative to normal (0).
 *
 * The world's `HAVEN_voice` sets everyone's defaults; a `HAVEN_voice_zone` overrides them for whoever stands in it.
 * A "broadcast" zone is a stage: heard by everyone at full volume, unmuffled, however far away.
 *
 * Each listener works this out from the positions it already receives, so everyone agrees without extra messages.
 * The falloff curve between near and far isn't documented by VRChat; this one drops fast, so groups a little way
 * apart don't talk over each other (25 m: about 36% at 10 m, 16% at 15 m, 4% at 20 m).
 */

export const DEFAULT_VOICE_RANGE = 25;
export const DEFAULT_VOICE_NEAR = 0;
/** Keep receiving a voice this far past its far distance, so walking back and forth at the edge doesn't flap. */
export const VOICE_SUBSCRIBE_MARGIN = 5;
/** The audio panner only gives voices their direction; their loudness is voiceGain's curve. */
export const VOICE_REF_DISTANCE = 1;
export const VOICE_ROLLOFF = 0;
/** Muffling: the low-pass cut-off goes from inaudible at `near` down to this at `far` (Hz). */
const LOWPASS_FAR_HZ = 1200;
const LOWPASS_OPEN_HZ = 20000;
const MIN_GAIN_DB = -40;
const MAX_GAIN_DB = 12;

export interface VoiceSettings {
  /** Decibels relative to normal. */
  gainDb: number;
  /** Metres within which the voice is at full volume (Infinity: everywhere). */
  near: number;
  /** Metres at which the voice falls silent (Infinity: never). */
  far: number;
  /** Whether distance muffles the voice. */
  lowpass: boolean;
}

export interface GLTFVoiceExtension {
  /** Metres at which voices fall silent (`far`). */
  range?: number;
  /** Metres within which voices are at full volume. */
  near?: number;
  /** Whether distant voices are muffled. */
  lowpass?: boolean;
  /** Decibels relative to normal. */
  gain?: number;
}

export interface GLTFVoiceZoneExtension {
  /** "broadcast": a stage, heard by everyone at full volume, unmuffled. Leave it out to set the values below. */
  mode?: "broadcast" | "custom";
  gain?: number;
  near?: number;
  /** Metres at which this speaker falls silent (`range` in HAVEN_voice). */
  far?: number;
  lowpass?: boolean;
  /** Box size in the node's space [x, y, z] (centred on the node); defaults to the node's mesh bounds. */
  size?: [number, number, number];
}

export const VoiceAudibilityMessage = "voice-audibility";

/** Game → main: the people you can hear now (user IDs); sent when it changes. */
export interface VoiceAudibilityMessageType {
  type: typeof VoiceAudibilityMessage;
  audible: string[];
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function clampVoiceRange(value: unknown): number {
  return finite(value) && value > 0 ? Math.min(10000, Math.max(3, value)) : DEFAULT_VOICE_RANGE;
}

function clampNear(value: unknown, fallback: number): number {
  return finite(value) && value >= 0 ? Math.min(10000, value) : fallback;
}

function clampGain(value: unknown, fallback: number): number {
  return finite(value) ? Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, value)) : fallback;
}

/** A world's voice defaults, from its (untrusted) HAVEN_voice. */
export function worldVoiceSettings(ext: GLTFVoiceExtension | undefined): VoiceSettings {
  const far = clampVoiceRange(ext?.range);
  return {
    gainDb: clampGain(ext?.gain, 0),
    near: Math.min(clampNear(ext?.near, DEFAULT_VOICE_NEAR), far),
    far,
    lowpass: ext?.lowpass !== false,
  };
}

/** The settings for a speaker standing in a zone: the zone's values over the world's. */
export function zoneVoiceSettings(world: VoiceSettings, zone: GLTFVoiceZoneExtension): VoiceSettings {
  const custom =
    zone.mode === "custom" || [zone.gain, zone.near, zone.far, zone.lowpass].some((value) => value !== undefined);
  if (zone.mode === "broadcast" || !custom) {
    return { gainDb: clampGain(zone.gain, world.gainDb), near: Infinity, far: Infinity, lowpass: false };
  }
  const far = zone.far !== undefined ? clampVoiceRange(zone.far) : world.far;
  return {
    gainDb: clampGain(zone.gain, world.gainDb),
    near: Math.min(clampNear(zone.near, world.near), far),
    far,
    lowpass: typeof zone.lowpass === "boolean" ? zone.lowpass : world.lowpass,
  };
}

/** How far between near (0) and far (1) a listener is. */
function falloff(distance: number, s: VoiceSettings): number {
  if (distance <= s.near) return 0;
  if (distance >= s.far) return 1;
  return (distance - s.near) / (s.far - s.near);
}

/** The voice's volume (linear gain) at `distance` metres. */
export function voiceGain(distance: number, s: VoiceSettings): number {
  const t = falloff(distance, s);
  return Math.pow(10, s.gainDb / 20) * (1 - t) * (1 - t);
}

/** The muffling low-pass cut-off at `distance` metres (Hz), or 0 for none. */
export function voiceLowpass(distance: number, s: VoiceSettings): number {
  if (!s.lowpass) return 0;
  const t = falloff(distance, s);
  if (t <= 0) return 0;
  return LOWPASS_OPEN_HZ * Math.pow(LOWPASS_FAR_HZ / LOWPASS_OPEN_HZ, t);
}

/** Whether to receive the voice at all (a little past its far distance). */
export function isVoiceAudible(distance: number, s: VoiceSettings): boolean {
  return s.far === Infinity || distance <= s.far + VOICE_SUBSCRIBE_MARGIN;
}
