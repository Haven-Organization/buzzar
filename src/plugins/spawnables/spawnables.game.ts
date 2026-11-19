import RAPIER from "@dimforge/rapier3d-compat";
import { addComponent, hasComponent } from "bitecs";
import { mat4, vec3, quat } from "gl-matrix";

import { playOneShotAudio } from "../../engine/audio/audio.game";
import { Player } from "../../engine/player/Player";
import { GameContext } from "../../engine/GameTypes";
import { createNodeFromGLTFURI, loadGLTF } from "../../engine/gltf/gltf.game";
import { createSphereMesh } from "../../engine/mesh/mesh.game";
import { defineModule, getModule, Thread } from "../../engine/module/module.common";
import { ownedNetworkedQuery } from "../../engine/network/network.game";
import { Networked, Owned } from "../../engine/network/NetworkComponents";
import { dynamicObjectCollisionGroups } from "../../engine/physics/CollisionGroups";
import {
  addPhysicsBody,
  addPhysicsCollider,
  applyTransformToRigidBody,
  PhysicsModule,
  PhysicsModuleState,
  registerCollisionHandler,
} from "../../engine/physics/physics.game";
import { markUpright } from "../../engine/physics/upright";
import { rememberThingFile, thingPhysics, ThingPhysics } from "./thingFile";
import { createPrefabEntity, Prefab, PrefabType, registerPrefab } from "../../engine/prefab/prefab.game";
import { getSpawnRules, isSpawnAllowed, isStockSpawnable, TakenObject } from "../../engine/network/spawnRules.game";
import {
  addObjectToWorld,
  RemoteAudioData,
  RemoteAudioEmitter,
  RemoteAudioSource,
  RemoteCollider,
  RemoteMaterial,
  RemoteNode,
  RemotePhysicsBody,
} from "../../engine/resource/RemoteResources";
import {
  AudioEmitterType,
  ColliderType,
  InteractableType,
  MaterialType,
  PhysicsBodyType,
} from "../../engine/resource/schema";
import { createDisposables } from "../../engine/utils/createDisposables";
import randomRange from "../../engine/utils/randomRange";
import { addInteractableComponent } from "../interaction/interaction.game";
import { getRotationNoAlloc } from "../../engine/utils/getRotationNoAlloc";
import { jitterDirection } from "../../engine/utils/jitterDirection";
import { ThirdRoomModule } from "../thirdroom/thirdroom.game";
import { ThirdRoomMessageType } from "../thirdroom/thirdroom.common";

const { abs, floor, random } = Math;

type SpawnablesModuleState = {
  hitAudioEmitters: Map<number, RemoteAudioEmitter>;
};

export const SpawnablesModule = defineModule<GameContext, SpawnablesModuleState>({
  name: "spawnables",
  create() {
    return {
      hitAudioEmitters: new Map(),
    };
  },
  init(ctx) {
    const module = getModule(ctx, SpawnablesModule);
    const physics = getModule(ctx, PhysicsModule);

    const crateAudioData = new RemoteAudioData(ctx.resourceManager, {
      name: "Crate Audio Data",
      uri: "/audio/hit.wav",
    });
    crateAudioData.addRef();

    registerPrefab(ctx, {
      name: "small-crate",
      type: PrefabType.Object,
      create: (ctx, { kinematic }) => {
        const size = 1;
        return createCrate(ctx, module, physics, size, crateAudioData, kinematic);
      },
    });

    registerPrefab(ctx, {
      name: "medium-crate",
      type: PrefabType.Object,
      create: (ctx, { kinematic }) => {
        const size = 1.75;
        return createCrate(ctx, module, physics, size, crateAudioData, kinematic);
      },
    });

    registerPrefab(ctx, {
      name: "large-crate",
      type: PrefabType.Object,
      create: (ctx, { kinematic }) => {
        const size = 2.5;
        return createCrate(ctx, module, physics, size, crateAudioData, kinematic);
      },
    });

    const ballAudioData = new RemoteAudioData(ctx.resourceManager, {
      name: "Ball Audio Data",
      uri: "/audio/bounce.wav",
    });
    ballAudioData.addRef();

    const ballAudioData2 = new RemoteAudioData(ctx.resourceManager, {
      name: "Ball Audio Data 2",
      uri: "/audio/clink.wav",
    });
    ballAudioData2.addRef();

    const ballAudioData3 = new RemoteAudioData(ctx.resourceManager, {
      name: "Ball Audio Data 3",
      uri: "/audio/clink2.wav",
    });
    ballAudioData3.addRef();

    const emissiveMaterial = new RemoteMaterial(ctx.resourceManager, {
      name: "Emissive Material",
      type: MaterialType.Standard,
      baseColorFactor: [0, 0.3, 1, 1],
      emissiveFactor: [0.7, 0.7, 0.7],
      metallicFactor: 0,
      roughnessFactor: 1,
    });
    emissiveMaterial.addRef();

    const mirrorMaterial = new RemoteMaterial(ctx.resourceManager, {
      name: "Mirror Material",
      type: MaterialType.Standard,
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 1,
      roughnessFactor: 0,
    });
    mirrorMaterial.addRef();

    const blackMirrorMaterial = new RemoteMaterial(ctx.resourceManager, {
      name: "Black Mirror Material",
      type: MaterialType.Standard,
      baseColorFactor: [0, 0, 0, 1],
      metallicFactor: 1,
      roughnessFactor: 0,
    });
    blackMirrorMaterial.addRef();

    registerPrefab(ctx, {
      name: "small-ball",
      type: PrefabType.Object,
      create: (ctx, { kinematic }) => {
        return createBall(ctx, module, physics, 0.25, emissiveMaterial, ballAudioData, kinematic);
      },
    });

    registerPrefab(ctx, {
      name: "mirror-ball",
      type: PrefabType.Object,
      create: (ctx, { kinematic }) => {
        return createBall(ctx, module, physics, 1, mirrorMaterial, ballAudioData, kinematic);
      },
    });

    registerPrefab(ctx, {
      name: "black-mirror-ball",
      type: PrefabType.Object,
      create: (ctx, { kinematic }) => {
        return createBall(ctx, module, physics, 1, blackMirrorMaterial, ballAudioData, kinematic);
      },
    });

    registerPrefab(ctx, {
      name: "emissive-ball",
      type: PrefabType.Object,
      create: (ctx, { kinematic }) => {
        return createBall(ctx, module, physics, 2, emissiveMaterial, ballAudioData, kinematic);
      },
    });

    registerPrefab(ctx, {
      name: "trampoline",
      type: PrefabType.Object,
      create: (ctx, { kinematic }) => createTrampoline(ctx, physics, kinematic),
    });

    // collision handlers
    const { physicsWorld } = getModule(ctx, PhysicsModule);

    const disposeCollisionHandler = registerCollisionHandler(ctx, (eid1, eid2, handle1, handle2, started) => {
      if (!started) {
        return;
      }

      // Buzzar: players jumping onto, standing on or walking into crates and balls is constant and expected (they're
      // platforms), so a player's own contacts make no sound. Objects hitting the floor or each other still do.
      if (hasComponent(ctx.world, Player, eid1) || hasComponent(ctx.world, Player, eid2)) {
        return;
      }

      const body1 = physicsWorld.getRigidBody(handle1);
      const body2 = physicsWorld.getRigidBody(handle2);

      let gain = 1;

      if (body1 && body2) {
        const linvel1 = body1.linvel();
        const linvel2 = body2.linvel();

        const manhattanLength =
          abs(linvel1.x) + abs(linvel1.y) + abs(linvel1.z) + abs(linvel2.x) + abs(linvel2.y) + abs(linvel2.z);

        gain = manhattanLength / 20;
      }

      const playbackRate = randomRange(0.3, 0.75);

      const emitter1 = module.hitAudioEmitters.get(eid1);
      if (emitter1) {
        const source = emitter1.sources[floor(random() * emitter1.sources.length)] as RemoteAudioSource;
        playOneShotAudio(ctx, source, gain, playbackRate);
      }

      const emitter2 = module.hitAudioEmitters.get(eid2);
      if (emitter2) {
        const source = emitter2.sources[floor(random() * emitter2.sources.length)] as RemoteAudioSource;
        playOneShotAudio(ctx, source, gain, playbackRate);
      }
    });

    return createDisposables([disposeCollisionHandler]);
  },
});

function createBall(
  ctx: GameContext,
  module: SpawnablesModuleState,
  physics: PhysicsModuleState,
  size: number,
  material: RemoteMaterial,
  ballAudioData: RemoteAudioData,
  kinematic = false
) {
  const node = new RemoteNode(ctx.resourceManager, {
    mesh: createSphereMesh(ctx, size, material),
  });

  addPhysicsCollider(
    ctx.world,
    node,
    new RemoteCollider(ctx.resourceManager, {
      type: ColliderType.Sphere,
      radius: size / 2,
      restitution: 1,
      density: 1,
    })
  );

  addPhysicsBody(
    ctx.world,
    physics,
    node,
    new RemotePhysicsBody(ctx.resourceManager, {
      type: kinematic ? PhysicsBodyType.Kinematic : PhysicsBodyType.Rigid,
    })
  );

  addInteractableComponent(ctx, physics, node, InteractableType.Grabbable);

  const audioEmitter = new RemoteAudioEmitter(ctx.resourceManager, {
    type: AudioEmitterType.Positional,
    sources: [
      new RemoteAudioSource(ctx.resourceManager, {
        audio: ballAudioData,
        loop: false,
        autoPlay: false,
      }),
    ],
  });

  node.audioEmitter = audioEmitter;

  module.hitAudioEmitters.set(node.eid, audioEmitter);

  return node;
}

const CRATE_GLTF_URI = "/gltf/sci_fi_crate.glb";
let cratePreloaded = false;

/**
 * Buzzar: load the crate model once you're in a world, so the first crate you spawn appears straight away instead of
 * after its download and parse (Third Room #416). The reference taken here is never released, so the model stays
 * cached even after every crate is deleted. (The balls are generated meshes and need nothing.)
 */
export function preloadSpawnables(ctx: GameContext) {
  if (cratePreloaded) return;
  cratePreloaded = true;
  loadGLTF(ctx, CRATE_GLTF_URI).catch((error) => {
    cratePreloaded = false;
    console.warn("Couldn't preload the crate model:", error);
  });
  // Buzzar: Things made from files: preloaded the same way, and read for how they behave (HAVEN_thing).
  for (const { uri } of Object.values(THING_FILES)) {
    loadGLTF(ctx, uri)
      .then((resource) => rememberThingFile(uri, resource.root as never))
      .catch((error) => console.warn(`Couldn't preload ${uri}:`, error));
  }
}

function createCrate(
  ctx: GameContext,
  module: SpawnablesModuleState,
  physics: PhysicsModuleState,
  size: number,
  crateAudioData: RemoteAudioData,
  kinematic = false
) {
  const node = createNodeFromGLTFURI(ctx, CRATE_GLTF_URI);

  node.scale.set([size, size, size]);

  const hitAudioSource = new RemoteAudioSource(ctx.resourceManager, {
    audio: crateAudioData,
    loop: false,
    autoPlay: false,
  });

  const audioEmitter = new RemoteAudioEmitter(ctx.resourceManager, {
    type: AudioEmitterType.Positional,
    sources: [hitAudioSource],
  });

  node.audioEmitter = audioEmitter;

  module.hitAudioEmitters.set(node.eid, audioEmitter);

  addPhysicsCollider(
    ctx.world,
    node,
    new RemoteCollider(ctx.resourceManager, {
      type: ColliderType.Box,
      size: [1, 1, 1],
      activeEvents: RAPIER.ActiveEvents.COLLISION_EVENTS,
      collisionGroups: dynamicObjectCollisionGroups,
    })
  );

  addPhysicsBody(
    ctx.world,
    physics,
    node,
    new RemotePhysicsBody(ctx.resourceManager, {
      type: kinematic ? PhysicsBodyType.Kinematic : PhysicsBodyType.Rigid,
    })
  );

  addInteractableComponent(ctx, physics, node, InteractableType.Grabbable);

  return node;
}

const TRAMPOLINE_GLTF_URI = "/gltf/things/trampoline.glb";

/**
 * Buzzar: the stock Trampoline Thing (scripts/buzzar/make-trampoline-thing.py). Its file says how it behaves: the mat
 * is marked with HAVEN_trampoline, which does the bouncing (engine/player/trampolines.ts), and HAVEN_thing makes it a
 * heavy drum (about 150 kg) that only turns about the vertical, so it always stands flat and nothing tips it over.
 * These are the same values, for before the file has loaded.
 */
const TRAMPOLINE_PHYSICS: ThingPhysics = {
  collider: { type: "cylinder", radius: 1.5, height: 0.53, offset: [0, 0.265, 0] },
  density: 40,
  rotation: "yaw",
  upright: true,
  spawn: { distance: 2.4, upright: true },
};

/** The physics of a Thing made from a file: collider, body, rotation lock and upright settling (HAVEN_thing). */
function addThingPhysics(
  ctx: GameContext,
  physics: PhysicsModuleState,
  node: RemoteNode,
  settings: ThingPhysics,
  kinematic: boolean
) {
  const c = settings.collider;
  addPhysicsCollider(
    ctx.world,
    node,
    new RemoteCollider(ctx.resourceManager, {
      type: c.type === "box" ? ColliderType.Box : c.type === "sphere" ? ColliderType.Sphere : ColliderType.Cylinder,
      ...(c.type === "box" ? { size: c.size } : { radius: c.radius }),
      ...(c.type === "cylinder" ? { height: c.height } : {}),
      offset: c.offset,
      ...(settings.density ? { density: settings.density } : {}),
      activeEvents: RAPIER.ActiveEvents.COLLISION_EVENTS,
      collisionGroups: dynamicObjectCollisionGroups,
    })
  );

  addPhysicsBody(
    ctx.world,
    physics,
    node,
    new RemotePhysicsBody(ctx.resourceManager, {
      type: kinematic ? PhysicsBodyType.Kinematic : PhysicsBodyType.Rigid,
    })
  );
  if (settings.rotation === "yaw") node.physicsBody?.body?.setEnabledRotations(false, true, false, true);
  // Held, it only turns to your heading; left tilted, it settles back level (engine/physics/upright.ts).
  if (settings.upright) markUpright(node);

  addInteractableComponent(ctx, physics, node, InteractableType.Grabbable);
}

function createTrampoline(ctx: GameContext, physics: PhysicsModuleState, kinematic = false) {
  const node = createNodeFromGLTFURI(ctx, TRAMPOLINE_GLTF_URI);
  addThingPhysics(ctx, physics, node, thingPhysics(TRAMPOLINE_GLTF_URI, TRAMPOLINE_PHYSICS), kinematic);
  return node;
}

/** Buzzar: Things made from files, by prefab id (for their spawn placement). */
const THING_FILES: Record<string, { uri: string; physics: ThingPhysics }> = {
  trampoline: { uri: TRAMPOLINE_GLTF_URI, physics: TRAMPOLINE_PHYSICS },
};

/**
 * Buzzar: how far in front of you a Thing appears (metres; default 1), and whether it's stood upright (turned only
 * to face the way you look) rather than tilted like your hand or view. From the Thing's file (HAVEN_thing spawn).
 */
function spawnPlacement(prefabId: string) {
  const thing = THING_FILES[prefabId];
  return thing ? thingPhysics(thing.uri, thing.physics).spawn : undefined;
}

const _direction = vec3.create();
const _spawnWorldQuat = quat.create();
const _spawnVelocity = new RAPIER.Vector3(0, 0, 0);
/** Buzzar: spawned objects leave your hand at this speed (m/s), tilted randomly by up to SPAWN_TOSS_JITTER. */
const SPAWN_TOSS_SPEED = 0.4;
const SPAWN_TOSS_JITTER = (20 * Math.PI) / 180;

// Returns false if the object exceeded the object cap
export function spawnPrefab(ctx: GameContext, spawnFrom: RemoteNode, prefabId: string, isXR: boolean): boolean {
  const { maxObjectCap } = getModule(ctx, ThirdRoomModule);
  const rules = getSpawnRules(ctx);

  // Buzzar: the world's object rules (other clients enforce them too, so spawning past them is pointless).
  if (!isSpawnAllowed(rules, prefabId)) return false;
  const limit = rules.maxPerUser ?? maxObjectCap;
  const ownedEnts = ownedNetworkedQuery(ctx.world);
  let ownedStock = 0;
  for (let i = 0; i < ownedEnts.length; i++) {
    const prefab = Prefab.get(ownedEnts[i]);
    if (prefab && isStockSpawnable(prefab) && !hasComponent(ctx.world, TakenObject, ownedEnts[i])) ownedStock++;
  }
  // bounce out of the function if we hit the max object cap
  if (ownedStock >= limit) {
    ctx.sendMessage(Thread.Main, {
      type: ThirdRoomMessageType.ObjectCapReached,
    });
    // TODO: send this message to the other clients
    // TODO: add two configs: max objects per client and max objects per room
    return false;
  }

  const prefab = createPrefabEntity(ctx, prefabId);
  const eid = prefab.eid;

  addComponent(ctx.world, Owned, eid);
  addComponent(ctx.world, Networked, eid, true);

  mat4.getTranslation(prefab.position, spawnFrom.worldMatrix);

  getRotationNoAlloc(_spawnWorldQuat, spawnFrom.worldMatrix);
  const direction = vec3.set(_direction, 0, 0, -1);
  vec3.transformQuat(direction, direction, _spawnWorldQuat);

  // place object at direction
  const placement = spawnPlacement(prefabId);
  if (placement?.upright) {
    // Level, facing the way you look (so it lands flat and comes out the same way round each time).
    direction[1] = 0;
    if (vec3.length(direction) < 1e-4) vec3.set(direction, 0, 0, -1);
    vec3.normalize(direction, direction);
    quat.setAxisAngle(_spawnWorldQuat, [0, 1, 0], Math.atan2(-direction[0], -direction[2]));
  }
  if (placement) vec3.scale(direction, direction, placement.distance);
  vec3.add(prefab.position, prefab.position, direction);
  prefab.quaternion.set(_spawnWorldQuat);
  if (placement) vec3.normalize(direction, direction);

  const body = prefab.physicsBody?.body;

  if (!body) {
    console.warn("could not find physics body for spawned entity " + eid);
    return true;
  }

  applyTransformToRigidBody(body, prefab);
  // Buzzar: a gentle, slightly random toss, so objects spawned in a row don't all drop along the same path
  // (Third Room #297).
  vec3.scale(direction, direction, SPAWN_TOSS_SPEED);
  jitterDirection(direction, SPAWN_TOSS_JITTER);
  _spawnVelocity.x = direction[0];
  _spawnVelocity.y = direction[1];
  _spawnVelocity.z = direction[2];
  body.setLinvel(_spawnVelocity, true);

  const privateScene = ctx.worldResource.environment?.privateScene;

  if (!privateScene) {
    throw new Error("private scene not found on environment");
  }

  addObjectToWorld(ctx, prefab);

  return true;
}
