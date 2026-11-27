/**
 * Buzzar: Things that spray (HAVEN_sprayer, sprayer.common.ts), such as a water gun.
 *
 * While you hold one, Use (left click) sprays and Pump (right click) works its pump; E lets go. The tank is yours
 * alone: its owner decides when it sprays and when it's pumped, and tells everyone (NetworkAction.HavenSpray), so
 * every client draws the same stream from the Thing's nozzle and plays its sounds there. The stream is drawn locally
 * on each client: drops leave the nozzle, fall, and vanish when they hit something.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { mat3, mat4, quat, vec3 } from "gl-matrix";
import { hasComponent } from "bitecs";
import { CylinderGeometry } from "three";

import { GameContext } from "../../engine/GameTypes";
import { defineModule, getModule } from "../../engine/module/module.common";
import { GLTFResource, loadGLTFAudioData } from "../../engine/gltf/gltf.game";
import { addChild, findChild } from "../../engine/component/transform";
import { offhandShift, thingsInUse } from "../../engine/avatar/holdPose";
import { createMesh } from "../../engine/mesh/mesh.game";
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
import { fullTank, pumpStrokeAt, readSprayer, SprayerSpec, stepTank, TankState } from "./sprayer.common";

/** How long a drop lives at most (seconds). */
const DROP_LIFE = 1.6;
const GRAVITY = 9.81;
/** Air slows drops a little (per second). */
const DRAG = 0.15;

interface Drop {
  /** Draws the stretch of stream from this drop to the one fired after it (or the nozzle). */
  node: RemoteNode;
  position: vec3;
  velocity: vec3;
  life: number;
  active: boolean;
  /** Changes each time the drop is fired, so a link to a drop that has since been reused is noticed. */
  serial: number;
  /** The drop fired just after this one in the same burst, which the stream joins up to. */
  newer?: Drop;
  newerSerial: number;
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
  /** Seconds left of the pump stroke in progress (ours: the tank's; others': from when they said they pumped). */
  strokeLeft: number;
  /** The part of the model that moves with the pump (pumpStroke.node), and where it rests. */
  pumpNode?: RemoteNode;
  pumpRest: vec3;
  /** The newest drop of the current burst; the stream runs from it to the nozzle. */
  newest?: Drop;
  /** The nozzle's slow wander (radians about x and y), so neighbouring drops fly almost the same way. */
  wobble: [number, number];
  wobbleTarget: [number, number];
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
      if (flags & PUMPED) {
        if (sprayer.sounds.pump) playOneShotAudio(ctx, sprayer.sounds.pump);
        sprayer.strokeLeft = sprayer.spec.pumpTime;
      }
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
  // A unit length of tube along +z: each drop's node stretches it to reach the next drop.
  const tube = new CylinderGeometry(spec.dropSize / 2, spec.dropSize / 2, 1, 10, 1, true);
  tube.rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const mesh = createMesh(ctx, tube, material);
  tube.dispose();
  mesh.addRef();

  const pumpName = spec.pumpStroke.node;
  const pumpNode = pumpName ? findChild(node, (n) => n.name === pumpName) : undefined;

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
    wobble: [0, 0],
    wobbleTarget: [0, 0],
    strokeLeft: 0,
    pumpNode,
    pumpRest: pumpNode ? vec3.clone(pumpNode.position) : vec3.create(),
  });
  usableThings.add(node.eid);
}

function disposeSprayer(ctx: GameContext, eid: number, sprayer: Sprayer) {
  for (const drop of sprayer.drops) removeObjectFromWorld(ctx, drop.node);
  sprayer.drops.length = 0;
  sprayer.mesh.removeRef();
  usableThings.delete(eid);
  offhandShift.delete(eid);
  thingsInUse.delete(eid);
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

let dropSerial = 0;

/** Fires a drop that left the nozzle `ago` seconds before now (drops in one frame are spaced out in time). */
function emitDrop(ctx: GameContext, sprayer: Sprayer, ago: number) {
  let drop = sprayer.drops.find((d) => !d.active);
  if (!drop) {
    if (sprayer.drops.length >= Math.ceil(sprayer.spec.rate * DROP_LIFE) + 4) return;
    const node = new RemoteNode(ctx.resourceManager, { name: "Water Stream", mesh: sprayer.mesh });
    addObjectToWorld(ctx, node);
    drop = {
      node,
      position: vec3.create(),
      velocity: vec3.create(),
      life: 0,
      active: false,
      serial: 0,
      newerSerial: 0,
    };
    sprayer.drops.push(drop);
  }
  const { spec, node, nozzle } = sprayer;
  mat4.getTranslation(_nozzleWorld, nozzle.worldMatrix);
  getRotationNoAlloc(_rotation, node.worldMatrix);
  vec3.transformQuat(_direction, spec.direction, _rotation);
  quat.fromEuler(_jitter, (sprayer.wobble[0] * 180) / Math.PI, (sprayer.wobble[1] * 180) / Math.PI, 0);
  vec3.transformQuat(_direction, _direction, _jitter);
  vec3.scale(drop.velocity, _direction, spec.speed);
  vec3.scaleAndAdd(drop.position, _nozzleWorld, drop.velocity, ago);
  drop.life = DROP_LIFE - ago;
  drop.active = true;
  drop.serial = ++dropSerial;
  drop.newer = undefined;
  drop.node.visible = true;
  // A reused drop jumps from wherever it last landed to the nozzle. Without this the renderer slid it there over a
  // few frames (it smooths every node towards its new place), drawing a stray tube near the nozzle now and then.
  drop.node.skipLerp = 10;
  // The previous drop of this burst now joins up to this one instead of the nozzle.
  const previous = sprayer.newest;
  if (previous && previous.active) {
    previous.newer = drop;
    previous.newerSerial = drop.serial;
  }
  sprayer.newest = drop;
}

/** The nozzle wanders smoothly within `spread` degrees, so the jet sways a little instead of scattering. */
function updateWobble(sprayer: Sprayer, dt: number) {
  const spread = (sprayer.spec.spread * Math.PI) / 180;
  const { wobble, wobbleTarget } = sprayer;
  if (Math.random() < dt * 4) {
    wobbleTarget[0] = (Math.random() - 0.5) * spread;
    wobbleTarget[1] = (Math.random() - 0.5) * spread;
  }
  const k = Math.min(1, dt * 6);
  wobble[0] += (wobbleTarget[0] - wobble[0]) * k;
  wobble[1] += (wobbleTarget[1] - wobble[1]) * k;
}

const FORWARD = vec3.fromValues(0, 0, 1);
const _gap = vec3.create();

/**
 * Each drop draws a tube from itself to the drop fired after it, and the newest drop of a burst to the nozzle, so the
 * stream is one unbroken jet. It thickens as it goes (the jet spreads); a drop whose neighbour is gone (it hit
 * something, or the burst ended) is a short blob.
 */
function shapeDrop(sprayer: Sprayer, drop: Drop) {
  const age = 1 - drop.life / DROP_LIFE;
  const width = 1 + 1.5 * age;
  let target: vec3 | undefined;
  if (drop.newer && drop.newer.active && drop.newer.serial === drop.newerSerial) target = drop.newer.position;
  else if (drop === sprayer.newest && sprayer.spraying)
    target = mat4.getTranslation(_nozzleWorld, sprayer.nozzle.worldMatrix);
  let length: number;
  if (target) {
    vec3.subtract(_gap, target, drop.position);
    length = vec3.length(_gap);
  } else {
    // Alone: a short blob pointing back along its flight.
    vec3.negate(_gap, drop.velocity);
    length = sprayer.spec.dropSize * width * 1.5;
  }
  const n = vec3.length(_gap);
  if (n > 1e-6) quat.rotationTo(drop.node.quaternion, FORWARD, vec3.scale(_gap, _gap, 1 / n));
  vec3.copy(drop.node.position, drop.position);
  vec3.set(drop.node.scale, width, width, Math.max(1e-4, length));
}

function updateDrops(ctx: GameContext, sprayer: Sprayer, dt: number) {
  const { physicsWorld } = getModule(ctx, PhysicsModule);
  const body = sprayer.node.physicsBody?.body;
  for (const drop of sprayer.drops) {
    if (!drop.active) continue;
    drop.life -= dt;
    const p = drop.position;
    const v = drop.velocity;
    v[1] -= GRAVITY * dt;
    vec3.scale(v, v, 1 - DRAG * dt);
    const step = vec3.length(v) * dt;
    let hit = false;
    if (step > 1e-5) {
      _ray.origin = { x: p[0], y: p[1], z: p[2] };
      _ray.dir = { x: v[0] / (step / dt), y: v[1] / (step / dt), z: v[2] / (step / dt) };
      const found = physicsWorld.castRay(_ray, step, true, undefined, undefined, undefined, body, isSolid);
      hit = !!found;
      if (found) pushWithDrop(ctx, sprayer, found, v);
    }
    if (hit || drop.life <= 0) {
      drop.active = false;
      drop.node.visible = false;
      continue;
    }
    p[0] += v[0] * dt;
    p[1] += v[1] * dt;
    p[2] += v[2] * dt;
  }
  // Shape after everything has moved, so each tube meets its neighbour where it is now.
  for (const drop of sprayer.drops) if (drop.active) shapeDrop(sprayer, drop);
}

const _impulse = new RAPIER.Vector3(0, 0, 0);
const _hitPoint = new RAPIER.Vector3(0, 0, 0);

/**
 * A drop that hits a loose object pushes it along its flight (HAVEN_sprayer `force`). Every client draws every
 * stream, so each pushes only what it moves itself: its own objects, and ones nobody shares (not networked). The
 * others' owners push theirs, and everyone sees the result.
 */
function pushWithDrop(ctx: GameContext, sprayer: Sprayer, found: RAPIER.RayColliderToi, velocity: vec3) {
  const { force, rate } = sprayer.spec;
  if (force <= 0) return;
  const target = found.collider.parent();
  if (!target || !target.isDynamic()) return;
  const { handleToEid } = getModule(ctx, PhysicsModule);
  const eid = handleToEid.get(found.collider.handle);
  if (eid === undefined || !weMove(ctx, eid)) return;
  const speed = vec3.length(velocity);
  if (speed < 1e-4) return;
  const scale = force / rate / speed;
  _impulse.x = velocity[0] * scale;
  _impulse.y = velocity[1] * scale;
  _impulse.z = velocity[2] * scale;
  const o = _ray.origin;
  const d = _ray.dir;
  _hitPoint.x = o.x + d.x * found.toi;
  _hitPoint.y = o.y + d.y * found.toi;
  _hitPoint.z = o.z + d.z * found.toi;
  target.applyImpulseAtPoint(_impulse, _hitPoint, true);
}

/** Whether this client moves the object `eid` belongs to: the first networked node up from it is ours, or none is. */
function weMove(ctx: GameContext, eid: number) {
  let node = getRemoteResource<RemoteNode>(ctx, eid);
  while (node) {
    if (hasComponent(ctx.world, Networked, node.eid)) return hasComponent(ctx.world, Owned, node.eid);
    node = node.parent;
  }
  return true;
}

const _inverse = mat4.create();
const _mat3 = mat3.create();
const _toPart = mat4.create();
const _offset = vec3.create();

/** Slides the hand on the pump, and the pump itself, back and forth over a stroke. */
function updatePumpStroke(sprayer: Sprayer) {
  const { spec, node, pumpNode } = sprayer;
  const t = spec.pumpTime > 0 ? 1 - sprayer.strokeLeft / spec.pumpTime : 1;
  const travel = pumpStrokeAt(t);
  const [x, y, z] = spec.pumpStroke.offset;
  if (travel > 0) offhandShift.set(node.eid, [x * travel, y * travel, z * travel]);
  else offhandShift.delete(node.eid);
  if (pumpNode?.parent) {
    // The offset is in the Thing's space; the part moves in its parent's.
    mat4.invert(_inverse, pumpNode.parent.worldMatrix);
    mat4.multiply(_toPart, _inverse, node.worldMatrix);
    vec3.set(_offset, x * travel, y * travel, z * travel);
    vec3.transformMat3(_offset, _offset, mat3.fromMat4(_mat3, _toPart));
    vec3.add(pumpNode.position, sprayer.pumpRest, _offset);
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
      sprayer.strokeLeft = sprayer.tank.pumping;
      if (step.pumped && sprayer.sounds.pump) playOneShotAudio(ctx, sprayer.sounds.pump);
      if (step.ranDry && sprayer.sounds.empty) playOneShotAudio(ctx, sprayer.sounds.empty);
      if (step.spraying !== sprayer.announced || step.pumped) {
        sendSprayState(ctx, eid, step.spraying, step.pumped);
        sprayer.announced = step.spraying;
      }
    } else sprayer.strokeLeft = Math.max(0, sprayer.strokeLeft - dt);

    updatePumpStroke(sprayer);
    updateSpraySound(ctx, sprayer);
    if (sprayer.spraying) thingsInUse.add(eid);
    else thingsInUse.delete(eid);

    if (sprayer.spraying) {
      updateWobble(sprayer, dt);
      const { rate } = sprayer.spec;
      sprayer.carry += rate * dt;
      while (sprayer.carry >= 1) {
        sprayer.carry -= 1;
        // `carry` drops' worth of time has passed since this one should have left the nozzle.
        emitDrop(ctx, sprayer, sprayer.carry / rate);
      }
    } else {
      sprayer.carry = 0;
      sprayer.newest = undefined;
    }
    updateDrops(ctx, sprayer, dt);
  }
}
