/**
 * Buzzar: Things that spray (HAVEN_sprayer, sprayer.common.ts), such as a water gun.
 *
 * While you hold one, Use (left click) sprays and Pump (right click) works its pump; E lets go. The tank is yours
 * alone: its owner decides when it sprays and when it's pumped, and tells everyone (NetworkAction.HavenSpray), so
 * every client draws the same stream from the Thing's nozzle and plays its sounds there. The stream is drawn locally
 * on each client: drops leave the nozzle, fall, and vanish when they hit something.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { mat4, quat, vec3 } from "gl-matrix";
import { hasComponent } from "bitecs";

import { GameContext } from "../../engine/GameTypes";
import { defineModule, getModule } from "../../engine/module/module.common";
import { GLTFResource, loadGLTFAudioData } from "../../engine/gltf/gltf.game";
import { addChild } from "../../engine/component/transform";
import { createSphereMesh } from "../../engine/mesh/mesh.game";
import { playAudio, playOneShotAudio, stopAudio } from "../../engine/audio/audio.game";
import { InputModule } from "../../engine/input/input.game";
import { ButtonActionState } from "../../engine/input/ActionMap";
import { ourPlayerQuery } from "../../engine/player/Player";
import { PhysicsModule } from "../../engine/physics/physics.game";
import { CollisionGroup } from "../../engine/physics/CollisionGroups";
import { Networked, Owned } from "../../engine/network/NetworkComponents";
import { getPeerIndexFromNetworkId, NetworkModule } from "../../engine/network/network.game";
import { NetworkAction } from "../../engine/network/NetworkAction";
import { registerInboundMessageHandler } from "../../engine/network/inbound.game";
import { broadcastReliable } from "../../engine/network/outbound.game";
import { writeMetadata } from "../../engine/network/serialization.game";
import {
  createCursorView,
  readUint32,
  readUint8,
  sliceCursorView,
  writeUint32,
  writeUint8,
} from "../../engine/allocator/CursorView";
import {
  addObjectToWorld,
  removeObjectFromWorld,
  RemoteAudioEmitter,
  RemoteAudioSource,
  RemoteMaterial,
  RemoteMesh,
  RemoteNode,
} from "../../engine/resource/RemoteResources";
import { getRemoteResource } from "../../engine/resource/resource.game";
import { AudioEmitterType, MaterialAlphaMode, MaterialType } from "../../engine/resource/schema";
import { getRotationNoAlloc } from "../../engine/utils/getRotationNoAlloc";
import { GrabComponent } from "../interaction/interaction.game";
import { usableThings } from "../interaction/usable";
import { fullTank, readSprayer, SprayerSpec, stepTank, TankState } from "./sprayer.common";

/** How long a drop lives at most (seconds). */
const DROP_LIFE = 1.6;
const GRAVITY = 9.81;
/** Air slows drops a little (per second). */
const DRAG = 0.15;

interface Drop {
  node: RemoteNode;
  velocity: vec3;
  life: number;
  active: boolean;
}

interface Sprayer {
  node: RemoteNode;
  spec: SprayerSpec;
  /** At the nozzle; carries the sounds. */
  nozzle: RemoteNode;
  sounds: {
    start?: RemoteAudioSource;
    spray?: RemoteAudioSource;
    pump?: RemoteAudioSource;
    empty?: RemoteAudioSource;
  };
  /** Only meaningful for the holder. */
  tank: TankState;
  /** Spraying this frame (ours: from the tank; others': as their owner said). */
  spraying: boolean;
  /** What we last told everyone. */
  announced: boolean;
  soundOn: boolean;
  /** When the spray loop takes over from the start sound (Date.now()), and whether it has. */
  loopAt: number;
  loopOn: boolean;
  carry: number;
  mesh: RemoteMesh;
  drops: Drop[];
}

interface SprayerModuleState {
  sprayers: Map<number, Sprayer>;
}

// The header (writeMetadata) alone is 13 bytes.
const messageView = createCursorView(new ArrayBuffer(64));
const SPRAYING = 1;
const PUMPED = 2;

function sendSprayState(ctx: GameContext, eid: number, spraying: boolean, pumped: boolean) {
  if (!hasComponent(ctx.world, Networked, eid)) return;
  writeMetadata(messageView, NetworkAction.HavenSpray);
  writeUint32(messageView, Networked.networkId[eid]);
  writeUint8(messageView, (spraying ? SPRAYING : 0) | (pumped ? PUMPED : 0));
  broadcastReliable(ctx, getModule(ctx, NetworkModule), sliceCursorView(messageView));
}

export const SprayerModule = defineModule<GameContext, SprayerModuleState>({
  name: "sprayers",
  create() {
    return { sprayers: new Map() };
  },
  init(ctx) {
    const network = getModule(ctx, NetworkModule);
    registerInboundMessageHandler(network, NetworkAction.HavenSpray, (ctx, v, peerId) => {
      const nid = readUint32(v);
      const flags = readUint8(v);
      // Only a sprayer's owner says what it does.
      if (getPeerIndexFromNetworkId(nid) !== network.peerIdToIndex.get(peerId)) return;
      const eid = network.networkIdToEntityId.get(nid);
      const sprayer = eid !== undefined ? getModule(ctx, SprayerModule).sprayers.get(eid) : undefined;
      if (!sprayer || hasComponent(ctx.world, Owned, sprayer.node.eid)) return;
      sprayer.spraying = (flags & SPRAYING) !== 0;
      if (flags & PUMPED && sprayer.sounds.pump) playOneShotAudio(ctx, sprayer.sounds.pump);
    });
  },
});

/** Per-instance sound sources for the file's KHR_audio sources (so two water guns don't share one). */
function soundFor(resource: GLTFResource, index: number | undefined): RemoteAudioSource | undefined {
  if (index === undefined) return undefined;
  const source = resource.root.extensions?.KHR_audio?.sources?.[index] as
    | { audio?: number; gain?: number; loop?: boolean }
    | undefined;
  if (source?.audio === undefined) return undefined;
  try {
    return new RemoteAudioSource(resource.manager, {
      audio: loadGLTFAudioData(resource, source.audio),
      gain: source.gain ?? 1,
      loop: source.loop ?? false,
      autoPlay: false,
    });
  } catch (error) {
    console.warn("A sprayer sound couldn't be loaded:", error);
    return undefined;
  }
}

/** Makes a Thing whose file has HAVEN_sprayer spray. Called once its file has loaded into `node`. */
export function attachSprayer(ctx: GameContext, node: RemoteNode, resource: GLTFResource) {
  const spec = readSprayer(resource.root as never);
  if (!spec) return;
  const module = getModule(ctx, SprayerModule);
  if (module.sprayers.has(node.eid)) return;

  const nozzle = new RemoteNode(ctx.resourceManager, { name: "Sprayer Nozzle" });
  vec3.copy(nozzle.position, spec.nozzle);
  addChild(node, nozzle);
  const sounds = {
    start: soundFor(resource, spec.sounds.start),
    spray: soundFor(resource, spec.sounds.spray),
    pump: soundFor(resource, spec.sounds.pump),
    empty: soundFor(resource, spec.sounds.empty),
  };
  if (sounds.spray) sounds.spray.loop = true;
  if (sounds.start) sounds.start.loop = false;
  const sources = [sounds.start, sounds.spray, sounds.pump, sounds.empty].filter((s): s is RemoteAudioSource => !!s);
  if (sources.length > 0) {
    nozzle.audioEmitter = new RemoteAudioEmitter(ctx.resourceManager, {
      type: AudioEmitterType.Positional,
      sources,
    });
  }

  const material = new RemoteMaterial(ctx.resourceManager, {
    name: "Sprayer Water",
    type: MaterialType.Standard,
    baseColorFactor: spec.color,
    alphaMode: spec.color[3] < 1 ? MaterialAlphaMode.BLEND : MaterialAlphaMode.OPAQUE,
    metallicFactor: 0,
    roughnessFactor: 0.05,
  });
  const mesh = createSphereMesh(ctx, spec.dropSize, material);
  mesh.addRef();

  module.sprayers.set(node.eid, {
    node,
    spec,
    nozzle,
    sounds,
    tank: fullTank(spec),
    spraying: false,
    announced: false,
    soundOn: false,
    loopAt: 0,
    loopOn: false,
    carry: 0,
    mesh,
    drops: [],
  });
  usableThings.add(node.eid);
}

function disposeSprayer(ctx: GameContext, eid: number, sprayer: Sprayer) {
  for (const drop of sprayer.drops) removeObjectFromWorld(ctx, drop.node);
  sprayer.drops.length = 0;
  sprayer.mesh.removeRef();
  usableThings.delete(eid);
  getModule(ctx, SprayerModule).sprayers.delete(eid);
}

const _nozzleWorld = vec3.create();
const _rotation = quat.create();
const _direction = vec3.create();
const _jitter = quat.create();
const _ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
/** Drops stop at anything solid except players: the stream leaves the nozzle inside its holder's own capsule. */
const isSolid = (collider: RAPIER.Collider) =>
  !collider.isSensor() && ((collider.collisionGroups() >>> 16) & CollisionGroup.Player) === 0;

function emitDrop(ctx: GameContext, sprayer: Sprayer) {
  let drop = sprayer.drops.find((d) => !d.active);
  if (!drop) {
    if (sprayer.drops.length >= Math.ceil(sprayer.spec.rate * DROP_LIFE) + 4) return;
    const node = new RemoteNode(ctx.resourceManager, { name: "Water Drop", mesh: sprayer.mesh });
    addObjectToWorld(ctx, node);
    drop = { node, velocity: vec3.create(), life: 0, active: false };
    sprayer.drops.push(drop);
  }
  const { spec, node, nozzle } = sprayer;
  mat4.getTranslation(_nozzleWorld, nozzle.worldMatrix);
  getRotationNoAlloc(_rotation, node.worldMatrix);
  vec3.transformQuat(_direction, spec.direction, _rotation);
  // Wander by up to `spread` degrees.
  const spread = (spec.spread * Math.PI) / 180;
  quat.fromEuler(
    _jitter,
    ((Math.random() - 0.5) * spread * 360) / Math.PI,
    ((Math.random() - 0.5) * spread * 360) / Math.PI,
    0
  );
  vec3.transformQuat(_direction, _direction, _jitter);
  vec3.scale(drop.velocity, _direction, spec.speed * (0.95 + Math.random() * 0.1));
  vec3.copy(drop.node.position, _nozzleWorld);
  drop.life = DROP_LIFE;
  drop.active = true;
  drop.node.visible = true;
  shapeDrop(sprayer, drop);
}

const FORWARD = vec3.fromValues(0, 0, 1);
const _along = vec3.create();
/** How much each drop overlaps the next along the stream, so they join up into one jet. */
const OVERLAP = 1.9;

/**
 * Drops are stretched along their flight and overlap the next one, so together they draw a jet of water rather than
 * a row of balls; older drops (further out) get wider and shorter, as a stream breaks up.
 */
function shapeDrop(sprayer: Sprayer, drop: Drop) {
  const speed = vec3.length(drop.velocity);
  if (speed < 1e-4) return;
  vec3.scale(_along, drop.velocity, 1 / speed);
  quat.rotationTo(drop.node.quaternion, FORWARD, _along);
  const { rate, dropSize } = sprayer.spec;
  const age = 1 - drop.life / DROP_LIFE;
  const width = 1 + 1.2 * age;
  const length = Math.max(1, ((speed / rate) * OVERLAP) / (2 * dropSize)) * (1 - 0.3 * age);
  vec3.set(drop.node.scale, width, width, Math.max(width, length));
}

function updateDrops(ctx: GameContext, sprayer: Sprayer, dt: number) {
  const { physicsWorld } = getModule(ctx, PhysicsModule);
  const body = sprayer.node.physicsBody?.body;
  for (const drop of sprayer.drops) {
    if (!drop.active) continue;
    drop.life -= dt;
    const p = drop.node.position;
    const v = drop.velocity;
    v[1] -= GRAVITY * dt;
    vec3.scale(v, v, 1 - DRAG * dt);
    const step = vec3.length(v) * dt;
    let hit = false;
    if (step > 1e-5) {
      _ray.origin = { x: p[0], y: p[1], z: p[2] };
      _ray.dir = { x: v[0] / (step / dt), y: v[1] / (step / dt), z: v[2] / (step / dt) };
      hit = !!physicsWorld.castRay(_ray, step, true, undefined, undefined, undefined, body, isSolid);
    }
    if (hit || drop.life <= 0) {
      drop.active = false;
      drop.node.visible = false;
      continue;
    }
    p[0] += v[0] * dt;
    p[1] += v[1] * dt;
    p[2] += v[2] * dt;
    shapeDrop(sprayer, drop);
  }
}

/** The start sound once when spraying begins, then the loop for as long as it lasts; both stop with the spray. */
function updateSpraySound(ctx: GameContext, sprayer: Sprayer) {
  const { start, spray } = sprayer.sounds;
  const now = Date.now();
  if (sprayer.spraying && !sprayer.soundOn) {
    sprayer.soundOn = true;
    if (start) {
      playAudio(ctx, start);
      sprayer.loopAt = now + sprayer.spec.startLength * 1000;
      sprayer.loopOn = false;
    } else if (spray) {
      playAudio(ctx, spray);
      sprayer.loopOn = true;
    }
  } else if (!sprayer.spraying && sprayer.soundOn) {
    sprayer.soundOn = false;
    if (start) stopAudio(ctx, start);
    if (spray && sprayer.loopOn) stopAudio(ctx, spray);
    sprayer.loopOn = false;
  }
  if (sprayer.spraying && !sprayer.loopOn && spray && now >= sprayer.loopAt) {
    playAudio(ctx, spray);
    sprayer.loopOn = true;
  }
}

export function SprayerSystem(ctx: GameContext) {
  const { sprayers } = getModule(ctx, SprayerModule);
  if (sprayers.size === 0) return;
  const input = getModule(ctx, InputModule);
  const dt = ctx.dt;

  const rigEid = ourPlayerQuery(ctx.world)[0];
  const heldEid = rigEid && hasComponent(ctx.world, GrabComponent, rigEid) ? GrabComponent.grabbedEntity[rigEid] : 0;
  const use = input.actionStates.get("UseHeld") as ButtonActionState | undefined;
  const pump = input.actionStates.get("PumpHeld") as ButtonActionState | undefined;

  for (const [eid, sprayer] of sprayers) {
    if (!getRemoteResource<RemoteNode>(ctx, eid)) {
      disposeSprayer(ctx, eid, sprayer);
      continue;
    }
    const ours = hasComponent(ctx.world, Owned, eid);
    if (ours) {
      const holding = heldEid === eid;
      const step = stepTank(
        sprayer.tank,
        sprayer.spec,
        dt,
        holding && !!use?.held,
        holding && !!pump?.pressed,
        holding && !!use?.pressed
      );
      sprayer.spraying = step.spraying;
      if (step.pumped && sprayer.sounds.pump) playOneShotAudio(ctx, sprayer.sounds.pump);
      if (step.ranDry && sprayer.sounds.empty) playOneShotAudio(ctx, sprayer.sounds.empty);
      if (step.spraying !== sprayer.announced || step.pumped) {
        sendSprayState(ctx, eid, step.spraying, step.pumped);
        sprayer.announced = step.spraying;
      }
    }

    updateSpraySound(ctx, sprayer);

    if (sprayer.spraying) {
      sprayer.carry += sprayer.spec.rate * dt;
      while (sprayer.carry >= 1) {
        sprayer.carry -= 1;
        emitDrop(ctx, sprayer);
      }
    } else {
      sprayer.carry = 0;
    }
    updateDrops(ctx, sprayer, dt);
  }
}
