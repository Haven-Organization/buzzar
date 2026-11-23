/**
 * Buzzar: who you can hear, worked out on the game thread (see voice.common.ts): each other player's voice follows
 * the world's voice settings (HAVEN_voice), or those of the voice zone they stand in (HAVEN_voice_zone; a stage is
 * heard by everyone). Volume and muffling go to their voice's audio emitter; the people you can hear are reported to
 * the main thread, so a LiveKit call only receives those voices.
 */
import { defineQuery } from "bitecs";
import { mat4, vec3 } from "gl-matrix";

import { GameContext } from "../GameTypes";
import { Thread } from "../module/module.common";
import { OurPlayer, Player } from "../player/Player";
import { RemoteNode } from "../resource/RemoteResources";
import { getRemoteResource } from "../resource/resource.game";
import {
  GLTFVoiceExtension,
  GLTFVoiceZoneExtension,
  isVoiceAudible,
  overrideVoiceSettings,
  VoiceOverride,
  VOICE_REF_DISTANCE,
  VOICE_ROLLOFF,
  VoiceAudibilityMessage,
  VoiceAudibilityMessageType,
  voiceGain,
  voiceLowpass,
  VoiceSettings,
  worldVoiceSettings,
  zoneVoiceSettings,
} from "./voice.common";

interface VoiceZone {
  node: RemoteNode;
  min: vec3;
  max: vec3;
  ext: GLTFVoiceZoneExtension;
}

const zones: VoiceZone[] = [];
const peerVoices = new Map<string, RemoteNode>();
/** What world scripts set for players (peer.setVoice), by peer ID: over the world's and zones' settings. */
const overrides = new Map<string, VoiceOverride>();

/** A world script's voice settings for a player (undefined: back to the world's). */
export function setPeerVoiceOverride(peerId: string, override: VoiceOverride | undefined) {
  if (override) overrides.set(peerId, { ...overrides.get(peerId), ...stripUndefined(override) });
  else overrides.delete(peerId);
}

function stripUndefined(o: VoiceOverride): VoiceOverride {
  const out: VoiceOverride = {};
  if (o.gainDb !== undefined) out.gainDb = o.gainDb;
  if (o.near !== undefined) out.near = o.near;
  if (o.far !== undefined) out.far = o.far;
  if (o.lowpass !== undefined) out.lowpass = o.lowpass;
  return out;
}
let worldVoice: VoiceSettings = worldVoiceSettings(undefined);

/** The world's voice defaults (HAVEN_voice on its scene; the defaults when it has none). */
export function setWorldVoice(ext: GLTFVoiceExtension | undefined) {
  worldVoice = worldVoiceSettings(ext);
}

/** A voice zone: a box in `node`'s space whose occupants get the zone's voice settings (a stage, by default). */
export function addVoiceZone(
  node: RemoteNode,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  ext: GLTFVoiceZoneExtension
) {
  zones.push({
    node,
    min: vec3.fromValues(min[0], min[1], min[2]),
    max: vec3.fromValues(max[0], max[1], max[2]),
    ext,
  });
}

/** The node carrying a player's voice (their avatar's root, with the voice audio emitter). */
export function registerPeerVoice(peerId: string, node: RemoteNode) {
  peerVoices.set(peerId, node);
}

const _inverse = mat4.create();
const _local = vec3.create();
const _position = vec3.create();
const _ours = vec3.create();

function liveZones(ctx: GameContext) {
  for (let i = zones.length - 1; i >= 0; i--) {
    if (getRemoteResource(ctx, zones[i].node.eid) !== zones[i].node) zones.splice(i, 1);
  }
  return zones;
}

/** The voice zone a point (world space) is in, if any (the first listed, where zones overlap). */
export function voiceZoneAt(ctx: GameContext, point: vec3): VoiceZone | undefined {
  for (const zone of liveZones(ctx)) {
    if (!mat4.invert(_inverse, zone.node.worldMatrix as unknown as mat4)) continue;
    vec3.transformMat4(_local, point, _inverse);
    if (
      _local[0] >= zone.min[0] &&
      _local[0] <= zone.max[0] &&
      _local[1] >= zone.min[1] &&
      _local[1] <= zone.max[1] &&
      _local[2] >= zone.min[2] &&
      _local[2] <= zone.max[2]
    ) {
      return zone;
    }
  }
  return undefined;
}

const ourPlayerQuery = defineQuery([OurPlayer, Player]);
const UPDATE_SECONDS = 0.2;
let sinceUpdate = UPDATE_SECONDS;
let lastAudible = "";

export function VoiceSystem(ctx: GameContext) {
  sinceUpdate += ctx.dt;
  if (sinceUpdate < UPDATE_SECONDS) return;
  sinceUpdate = 0;

  const ourEid = ourPlayerQuery(ctx.world)[0];
  const ourNode = ourEid !== undefined ? getRemoteResource<RemoteNode>(ctx, ourEid) : undefined;
  if (!ourNode) return;
  mat4.getTranslation(_ours, ourNode.worldMatrix as unknown as mat4);

  const audible: string[] = [];
  for (const [peerId, node] of peerVoices) {
    if (getRemoteResource(ctx, node.eid) !== node) {
      peerVoices.delete(peerId);
      continue;
    }
    const emitter = node.audioEmitter;
    if (!emitter) continue;
    mat4.getTranslation(_position, node.worldMatrix as unknown as mat4);
    const distance = vec3.distance(_position, _ours);

    // Their voice settings: the world's, or those of the zone they stand in (a stage: everyone hears them).
    const zone = voiceZoneAt(ctx, _position);
    const placed = zone ? zoneVoiceSettings(worldVoice, zone.ext) : worldVoice;
    // A world script's settings for them (peer.setVoice) win, like VRChat's SetVoice*.
    const override = overrides.get(peerId);
    const settings = override ? overrideVoiceSettings(placed, override) : placed;
    emitter.gain = voiceGain(distance, settings);
    emitter.lowpassFrequency = voiceLowpass(distance, settings);
    emitter.refDistance = VOICE_REF_DISTANCE;
    emitter.rolloffFactor = VOICE_ROLLOFF;
    if (isVoiceAudible(distance, settings)) audible.push(peerId);
  }

  audible.sort();
  const key = audible.join("\n");
  if (key === lastAudible) return;
  lastAudible = key;
  ctx.sendMessage<VoiceAudibilityMessageType>(Thread.Main, { type: VoiceAudibilityMessage, audible });
}

/** For a new world: forget the old one's stage areas and report everyone again. */
export function resetVoice() {
  zones.length = 0;
  lastAudible = "";
  worldVoice = worldVoiceSettings(undefined);
  overrides.clear();
}
