/**
 * Buzzar: who you can hear, worked out on the game thread (see voice.common.ts): each other player's voice fades with
 * distance and stops at the world's voice range, unless they stand in a stage area (HAVEN_voice_zone "broadcast"),
 * where everyone hears them at full volume. The people you can hear are reported to the main thread, so a LiveKit
 * call only receives those voices.
 */
import { defineQuery } from "bitecs";
import { mat4, vec3 } from "gl-matrix";

import { GameContext } from "../GameTypes";
import { Thread } from "../module/module.common";
import { OurPlayer, Player } from "../player/Player";
import { RemoteNode } from "../resource/RemoteResources";
import { getRemoteResource } from "../resource/resource.game";
import {
  clampVoiceRange,
  GLTFVoiceZoneExtension,
  VOICE_REF_DISTANCE,
  VOICE_ROLLOFF,
  VOICE_SUBSCRIBE_MARGIN,
  VoiceAudibilityMessage,
  VoiceAudibilityMessageType,
  voiceRangeGain,
} from "./voice.common";

interface VoiceZone {
  node: RemoteNode;
  min: vec3;
  max: vec3;
}

const zones: VoiceZone[] = [];
const peerVoices = new Map<string, RemoteNode>();
let voiceRange = clampVoiceRange(undefined);

/** The world's voice range (HAVEN_voice.range on its scene; the default when it has none). */
export function setWorldVoiceRange(range: unknown) {
  voiceRange = clampVoiceRange(range);
}

/** A stage area: a box in `node`'s space whose occupants everyone hears. */
export function addVoiceZone(
  node: RemoteNode,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  ext: GLTFVoiceZoneExtension
) {
  if ((ext.mode ?? "broadcast") !== "broadcast") return;
  zones.push({ node, min: vec3.fromValues(min[0], min[1], min[2]), max: vec3.fromValues(max[0], max[1], max[2]) });
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

/** Whether a point (world space) is inside a stage area. */
export function isInBroadcastZone(ctx: GameContext, point: vec3): boolean {
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
      return true;
    }
  }
  return false;
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

    if (isInBroadcastZone(ctx, _position)) {
      // On stage: heard by everyone, at full volume, still from where they stand.
      emitter.gain = 1;
      emitter.rolloffFactor = 0;
      audible.push(peerId);
    } else {
      emitter.gain = voiceRangeGain(distance, voiceRange);
      emitter.refDistance = VOICE_REF_DISTANCE;
      emitter.rolloffFactor = VOICE_ROLLOFF;
      if (distance <= voiceRange + VOICE_SUBSCRIBE_MARGIN) audible.push(peerId);
    }
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
  voiceRange = clampVoiceRange(undefined);
}
