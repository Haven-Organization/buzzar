import RAPIER from "@dimforge/rapier3d-compat";
import { addComponent, hasComponent } from "bitecs";
import { mat4, vec3, quat } from "gl-matrix";

import { getLimitOverrides } from "../../engine/player/movement.game";
import { playOneShotAudio } from "../../engine/audio/audio.game";
import { Player } from "../../engine/player/Player";
import { GameContext } from "../../engine/GameTypes";
import { createNodeFromGLTFURI, loadDefaultGLTFScene, loadGLTF } from "../../engine/gltf/gltf.game";
import { createSphereMesh } from "../../engine/mesh/mesh.game";
import { defineModule, getModule, Thread } from "../../engine/module/module.common";
import { ownedNetworkedQuery } from "../../engine/network/network.game";
import { Networked, Owned } from "../../engine/network/NetworkComponents";
import { CollisionGroup, dynamicObjectCollisionGroups } from "../../engine/physics/CollisionGroups";
import { scaleTrampolineBounce } from "../../engine/player/trampolines";
import { ThingPrefabOptions, thingVariablesFor, tintNodeTree, variantMaterial } from "./thingVariables.game";
import {
  encodeThingVariables,
  hasThingVariables,
  sanitizeThingVariables,
  ThingVariables,
} from "./thingVariables.common";
import {
  addPhysicsBody,
  addPhysicsCollider,
  applyTransformToRigidBody,
  PhysicsModule,
  PhysicsModuleState,
  registerCollisionHandler,
} from "../../engine/physics/physics.game";
import { markUpright } from "../../engine/physics/upright";
import {
  gltfBounds,
  loadedThingFile,
  physicsFromBounds,
  readThingPhysics,
  rememberThingFile,
  thingPhysics,
  ThingPhysics,
} from "./thingFile";
import {
  createPrefabEntity,
  Prefab,
  PrefabCreateData,
  PrefabType,
  registerPrefab,
  registerPrefabResolver,
} from "../../engine/prefab/prefab.game";
import { getSpawnRules, isSpawnAllowed, TakenObject } from "../../engine/network/spawnRules.game";
import { isCustomThingId, isThingId, rememberThingBehaviours } from "../../engine/network/spawnRules.common";
import { resolveMxcUri } from "../avatar-pedestals/pedestals.game";
import { attachSprayer } from "../sprayers/sprayer.game";
import { usableThings } from "../interaction/usable";
import { readAssetMetadata } from "../../engine/gltf/assetMetadata";
import { getRemoteResource } from "../../engine/resource/resource.game";
import {
  addObjectToWorld,
  removeObjectFromWorld,
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
import {
  addInteractableComponent,
  canHoldSpawned,
  HELD_SPAWN_DISTANCE,
  holdSpawnedObject,
} from "../interaction/interaction.game";
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
      create: (ctx, options: ThingPrefabOptions) => {
        const v = thingVariablesFor("small-crate", options);
        return createCrate(ctx, module, physics, 1 * (v.size ?? 1), crateAudioData, options.kinematic, v);
      },
    });

    registerPrefab(ctx, {
      name: "medium-crate",
      type: PrefabType.Object,
      create: (ctx, options: ThingPrefabOptions) => {
        const v = thingVariablesFor("medium-crate", options);
        return createCrate(ctx, module, physics, 1.75 * (v.size ?? 1), crateAudioData, options.kinematic, v);
      },
    });

    registerPrefab(ctx, {
      name: "large-crate",
      type: PrefabType.Object,
      create: (ctx, options: ThingPrefabOptions) => {
        const v = thingVariablesFor("large-crate", options);
        return createCrate(ctx, module, physics, 2.5 * (v.size ?? 1), crateAudioData, options.kinematic, v);
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
      create: (ctx, options: ThingPrefabOptions) => {
        const v = thingVariablesFor("mirror-ball", options);
        const material =
          v.tint || v.glow !== undefined ? variantMaterial(ctx, mirrorMaterial, v.tint, v.glow) : mirrorMaterial;
        return createBall(ctx, module, physics, 1 * (v.size ?? 1), material, ballAudioData, options.kinematic, v);
      },
    });

    registerPrefab(ctx, {
      name: "black-mirror-ball",
      type: PrefabType.Object,
      create: (ctx, options: ThingPrefabOptions) => {
        const v = thingVariablesFor("black-mirror-ball", options);
        const material =
          v.tint || v.glow !== undefined
            ? variantMaterial(ctx, blackMirrorMaterial, v.tint, v.glow)
            : blackMirrorMaterial;
        return createBall(ctx, module, physics, 1 * (v.size ?? 1), material, ballAudioData, options.kinematic, v);
      },
    });

    registerPrefab(ctx, {
      name: "emissive-ball",
      type: PrefabType.Object,
      create: (ctx, options: ThingPrefabOptions) => {
        const v = thingVariablesFor("emissive-ball", options);
        const material =
          v.tint || v.glow !== undefined ? variantMaterial(ctx, emissiveMaterial, v.tint, v.glow) : emissiveMaterial;
        return createBall(ctx, module, physics, 2 * (v.size ?? 1), material, ballAudioData, options.kinematic, v);
      },
    });

    registerPrefab(ctx, {
      name: "trampoline",
      type: PrefabType.Object,
      create: (ctx, options: ThingPrefabOptions) =>
        createTrampoline(ctx, physics, options.kinematic, thingVariablesFor("trampoline", options)),
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

    // Buzzar: custom Things, named by their file's mxc:// URI, get a prefab the first time they're spawned or seen.
    const disposeResolver = registerPrefabResolver((_ctx, name) =>
      isCustomThingId(name)
        ? {
            name,
            type: PrefabType.Object,
            create: (ctx: GameContext, options: ThingPrefabOptions) =>
              createFileThing(ctx, physics, name, !!options.kinematic),
          }
        : undefined
    );

    return createDisposables([disposeCollisionHandler, disposeResolver]);
  },
});

function createBall(
  ctx: GameContext,
  module: SpawnablesModuleState,
  physics: PhysicsModuleState,
  size: number,
  material: RemoteMaterial,
  ballAudioData: RemoteAudioData,
  kinematic = false,
  variables: ThingVariables = {}
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
      restitution: variables.bounciness ?? 1,
      density: 1,
    })
  );

  addPhysicsBody(
    ctx.world,
    physics,
    node,
    new RemotePhysicsBody(ctx.resourceManager, {
      type: kinematic ? PhysicsBodyType.Kinematic : PhysicsBodyType.Rigid,
      ...(variables.weight !== undefined ? { mass: variables.weight } : {}),
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
  kinematic = false,
  variables: ThingVariables = {}
) {
  const tint = variables.tint;
  const node = createNodeFromGLTFURI(
    ctx,
    CRATE_GLTF_URI,
    tint ? (loaded) => tintNodeTree(ctx, loaded, tint) : undefined
  );

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
      ...(variables.bounciness !== undefined ? { restitution: variables.bounciness } : {}),
    })
  );

  addPhysicsBody(
    ctx.world,
    physics,
    node,
    new RemotePhysicsBody(ctx.resourceManager, {
      type: kinematic ? PhysicsBodyType.Kinematic : PhysicsBodyType.Rigid,
      ...(variables.weight !== undefined ? { mass: variables.weight } : {}),
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
  kinematic: boolean,
  mass?: number
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
      ...(mass !== undefined ? { mass } : {}),
    })
  );
  if (settings.rotation === "yaw") node.physicsBody?.body?.setEnabledRotations(false, true, false, true);
  // Held, it only turns to your heading; left tilted, it settles back level (engine/physics/upright.ts).
  if (settings.upright) markUpright(node);

  addInteractableComponent(ctx, physics, node, InteractableType.Grabbable);
}

function createTrampoline(
  ctx: GameContext,
  physics: PhysicsModuleState,
  kinematic = false,
  variables: ThingVariables = {}
) {
  const { tint, springiness } = variables;
  const node = createNodeFromGLTFURI(ctx, TRAMPOLINE_GLTF_URI, (loaded) => {
    if (tint) tintNodeTree(ctx, loaded, tint);
    // The mat's HAVEN_trampoline settings are registered as the file loads, just before this.
    if (springiness !== undefined) scaleTrampolineBounce(loaded, springiness);
  });
  addThingPhysics(
    ctx,
    physics,
    node,
    thingPhysics(TRAMPOLINE_GLTF_URI, TRAMPOLINE_PHYSICS),
    kinematic,
    variables.weight
  );
  return node;
}

/** Buzzar: Things made from files, by prefab id (for their spawn placement). */
const THING_FILES: Record<string, { uri: string; physics: ThingPhysics }> = {
  trampoline: { uri: TRAMPOLINE_GLTF_URI, physics: TRAMPOLINE_PHYSICS },
};

/**
 * Buzzar: how far in front of you a Thing appears (metres; default 1), whether it's stood upright (turned only
 * to face the way you look) rather than tilted like your hand or view, and whether it appears in your hold. From the
 * Thing's file (HAVEN_thing spawn).
 */
function spawnPlacement(prefabId: string) {
  if (isCustomThingId(prefabId)) return fileThingPhysics(prefabId).spawn;
  const thing = THING_FILES[prefabId];
  return thing ? thingPhysics(thing.uri, thing.physics).spawn : undefined;
}

/**
 * Buzzar: a custom Thing's physics: its file's HAVEN_thing, over a box fitted around it (before the file has loaded,
 * a small box).
 */
function fileThingPhysics(mxc: string): ThingPhysics {
  const file = loadedThingFile(mxc);
  return readThingPhysics(file, physicsFromBounds(file ? gltfBounds(file) : undefined));
}

type FileThingState = { status: "loading" | "ready" | "failed"; waiting: (() => void)[] };
/** Buzzar: custom Thing files by mxc:// URI, as they load. */
const fileThings = new Map<string, FileThingState>();

/** Loads a custom Thing's file (once), learning its physics and behaviours. */
function loadFileThing(ctx: GameContext, mxc: string) {
  const url = resolveMxcUri(ctx, mxc);
  if (!url) return Promise.reject(new Error("The homeserver for Matrix files isn't known yet"));
  return loadGLTF(ctx, url).then((resource) => {
    rememberThingFile(mxc, resource.root as never);
    rememberThingBehaviours(mxc, resource.root.extensionsUsed);
    return resource;
  });
}

/**
 * Buzzar: whether a custom Thing's file is ready to spawn. If it isn't yet, starts loading it and calls `then` once
 * it is ("pending"); "failed" if it can't be loaded.
 */
export function customThingReady(ctx: GameContext, mxc: string, then: () => void): "ready" | "pending" | "failed" {
  const known = fileThings.get(mxc);
  if (known?.status === "ready" || known?.status === "failed") return known.status;
  if (known) {
    known.waiting.push(then);
    return "pending";
  }
  const state: FileThingState = { status: "loading", waiting: [then] };
  fileThings.set(mxc, state);
  loadFileThing(ctx, mxc)
    .then(() => {
      state.status = "ready";
      for (const done of state.waiting.splice(0)) done();
    })
    .catch((error) => {
      console.warn(`Couldn't load the Thing ${mxc}:`, error);
      // Let a later spawn try again (the homeserver may not have been known yet).
      fileThings.delete(mxc);
      state.status = "failed";
      state.waiting.length = 0;
    });
  return "pending";
}

/**
 * Buzzar: a Thing made from someone's own .glb on Matrix. Ours are only spawned once the file has loaded, so their
 * physics come from it straight away; one another player spawns may arrive first, so it starts as a small box and is
 * given the file's collider once the file loads. The world's rules are checked again then, against the behaviours
 * the file turns out to have.
 */
function createFileThing(ctx: GameContext, physics: PhysicsModuleState, mxc: string, kinematic: boolean) {
  // When the file is already here (always, for one we spawn), its name and whether it does something while held are
  // known at once, before it goes in our hands (the hover card and left click depend on them).
  const file = loadedThingFile(mxc);
  const node = new RemoteNode(ctx.resourceManager, {
    name: (file && readAssetMetadata(file as never).name) || "Thing",
  });
  if (file?.extensions?.HAVEN_sprayer) usableThings.add(node.eid);
  const used = fileThingPhysics(mxc);
  addThingPhysics(ctx, physics, node, used, kinematic);
  const url = resolveMxcUri(ctx, mxc);
  if (!url) return node;
  (loadedThingFile(mxc) ? loadGLTF(ctx, url) : loadFileThing(ctx, mxc))
    .then((resource) => {
      if (!getRemoteResource<RemoteNode>(ctx, node.eid)) return; // removed while it loaded
      const ours = hasComponent(ctx.world, Owned, node.eid);
      if (!isSpawnAllowed(getSpawnRules(ctx), mxc) && !(ours && getLimitOverrides(ctx).ignoreOwn)) {
        // A behaviour this world blocks. Ours goes away; someone else's stays invisible and can't be touched (its
        // owner's network updates still refer to it).
        if (ours) removeObjectFromWorld(ctx, node);
        else removeColliders(physics, node);
        return;
      }
      loadDefaultGLTFScene(ctx, resource, { existingNode: node });
      // Its name from the file's details (HAVEN_metadata), for the hover label.
      node.name = readAssetMetadata(resource.root).name ?? "Thing";
      // Behaviours in the file: spraying (HAVEN_sprayer).
      attachSprayer(ctx, node, resource);
      const settings = fileThingPhysics(mxc);
      if (JSON.stringify(settings) !== JSON.stringify(used)) replaceThingPhysics(physics, node, settings);
    })
    .catch((error) => console.warn(`Couldn't load the Thing ${mxc}:`, error));
  return node;
}

function removeColliders(physics: PhysicsModuleState, node: RemoteNode) {
  const body = node.physicsBody?.body;
  if (!body) return;
  for (let i = body.numColliders() - 1; i >= 0; i--) {
    const old = body.collider(i);
    physics.handleToEid.delete(old.handle);
    physics.physicsWorld.removeCollider(old, false);
  }
}

/** Gives a Thing's body a new collider (and rotation lock), once its file says what they are. */
function replaceThingPhysics(physics: PhysicsModuleState, node: RemoteNode, settings: ThingPhysics) {
  const body = node.physicsBody?.body;
  if (!body) return;
  removeColliders(physics, node);
  const c = settings.collider;
  const desc =
    c.type === "box"
      ? RAPIER.ColliderDesc.cuboid(c.size[0] / 2, c.size[1] / 2, c.size[2] / 2)
      : c.type === "sphere"
      ? RAPIER.ColliderDesc.ball(c.radius)
      : RAPIER.ColliderDesc.cylinder(c.height / 2, c.radius);
  desc.setTranslation(c.offset[0], c.offset[1], c.offset[2]);
  desc.setCollisionGroups(dynamicObjectCollisionGroups);
  desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  if (settings.density) desc.setDensity(settings.density);
  // As addPhysicsBody does: the body's mass, or 1 kg.
  desc.setMass(node.physicsBody?.mass || 1);
  const collider = physics.physicsWorld.createCollider(desc, body);
  physics.handleToEid.set(collider.handle, node.eid);
  body.setEnabledRotations(true, true, true, true);
  if (settings.rotation === "yaw") body.setEnabledRotations(false, true, false, true);
  if (settings.upright) markUpright(node);
}

/** Buzzar: how far up, in steps of SPAWN_LIFT_STEP (m), a spawned object may be moved to clear what's already there. */
const SPAWN_LIFT_STEP = 0.1;
const SPAWN_LIFT_STEPS = 20;
// Solid, and pushes back: not sensors, nor players' capsules (no solver contacts, so they never shove objects).
const pushesObjects = (collider: RAPIER.Collider) => !collider.isSensor() && collider.solverGroups() !== 0;

/** How far a body's solid shapes reach from its centre, in metres (a bounding sphere's radius). */
function bodyReach(body: RAPIER.RigidBody) {
  const centre = body.translation();
  let reach = 0;
  for (let i = 0; i < body.numColliders(); i++) {
    const c = body.collider(i);
    if (c.isSensor()) continue;
    const t = c.translation();
    const offset = Math.hypot(t.x - centre.x, t.y - centre.y, t.z - centre.z);
    let size = 0.5;
    const shape = c.shape as { halfExtents?: { x: number; y: number; z: number }; radius?: number };
    if (shape.halfExtents) size = Math.hypot(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
    else if (typeof shape.radius === "number") size = shape.radius;
    reach = Math.max(reach, offset + size);
  }
  return reach;
}

/**
 * Buzzar: an object spawned overlapping something solid (another object, a wall) was thrown out of it by the
 * physics solver, often high into the air. Raise it until it's clear, up to 2 m (or twice its reach, for a big one); past that, leave it where it was.
 * Returns whether it moved.
 */
function liftClearOfOverlaps(physicsWorld: RAPIER.World, body: RAPIER.RigidBody): boolean {
  const start = body.translation();
  // A big Thing (a crate cloned at 4×) can start deep in the floor: lift it as far as its own size, in as many steps.
  const step = Math.max(SPAWN_LIFT_STEP, (2 * bodyReach(body)) / SPAWN_LIFT_STEPS);
  const overlaps = () => {
    physicsWorld.propagateModifiedBodyPositionsToColliders();
    for (let i = 0; i < body.numColliders(); i++) {
      const c = body.collider(i);
      if (c.isSensor()) continue;
      // A zero-length sweep that stops at penetration: just as exact, but intersectionWithShape costs ~0.5 s per
      // call against big triangle-mesh worlds whenever nothing overlaps (see plugins/posture/postureClearance.ts).
      const hit = physicsWorld.castShape(
        c.translation(),
        c.rotation(),
        { x: 0, y: 1, z: 0 },
        c.shape,
        0,
        true,
        undefined,
        undefined,
        undefined,
        body,
        pushesObjects
      );
      if (hit) return true;
    }
    return false;
  };
  if (!overlaps()) return false;
  for (let i = 1; i <= SPAWN_LIFT_STEPS; i++) {
    body.setTranslation({ x: start.x, y: start.y + i * step, z: start.z }, true);
    if (!overlaps()) return true;
  }
  body.setTranslation(start, true);
  physicsWorld.propagateModifiedBodyPositionsToColliders();
  return false;
}

/**
 * Buzzar (Third Room #300): sweeps the object's shape from where you are toward its spawn point; if something solid
 * is in the way (a window, a wall), the object is placed against it on your side instead of beyond it. Your own
 * player isn't counted. Returns "clear" (nothing in the way), "moved", or "no-room" when, placed there, it would
 * overlap a player (too close to the obstacle for it to fit on your side).
 */
function stopAtObstacle(
  physicsWorld: RAPIER.World,
  body: RAPIER.RigidBody,
  origin: vec3,
  direction: vec3,
  distance: number
): "clear" | "moved" | "no-room" {
  let nearest = distance;
  // The body was just moved to the spawn point; its colliders follow only once positions are propagated.
  physicsWorld.propagateModifiedBodyPositionsToColliders();
  for (let i = 0; i < body.numColliders(); i++) {
    const c = body.collider(i);
    if (c.isSensor()) continue;
    // The collider's offset from the body, so the sweep starts with the shape centred on the origin like the body.
    const bt = body.translation();
    const ct = c.translation();
    const start = { x: origin[0] + ct.x - bt.x, y: origin[1] + ct.y - bt.y, z: origin[2] + ct.z - bt.z };
    const hit = physicsWorld.castShape(
      start,
      c.rotation(),
      { x: direction[0], y: direction[1], z: direction[2] },
      c.shape,
      distance,
      // Ignore what the shape already overlaps at your position (your own avatar's parts, the floor under a big
      // crate): only surfaces it moves into on the way out count.
      false,
      undefined,
      undefined,
      undefined,
      body,
      notPlayer
    );
    if (hit && hit.toi < nearest) nearest = hit.toi;
  }
  if (nearest >= distance) return "clear";
  const at = Math.max(0, nearest - 0.02);
  body.setTranslation(
    { x: origin[0] + direction[0] * at, y: origin[1] + direction[1] * at, z: origin[2] + direction[2] * at },
    true
  );
  physicsWorld.propagateModifiedBodyPositionsToColliders();
  for (let i = 0; i < body.numColliders(); i++) {
    const c = body.collider(i);
    if (c.isSensor()) continue;
    const zero = { x: 0, y: 1, z: 0 };
    const hit = physicsWorld.castShape(
      c.translation(),
      c.rotation(),
      zero,
      c.shape,
      0,
      true,
      undefined,
      undefined,
      undefined,
      body,
      isPlayer
    );
    if (hit) return "no-room";
  }
  return "moved";
}

const isPlayer = (collider: RAPIER.Collider) => ((collider.collisionGroups() >>> 16) & CollisionGroup.Player) !== 0;

const notPlayer = (collider: RAPIER.Collider) =>
  pushesObjects(collider) && ((collider.collisionGroups() >>> 16) & CollisionGroup.Player) === 0;

const _spawnOrigin = vec3.create();
const _direction = vec3.create();
const _spawnWorldQuat = quat.create();
const _spawnVelocity = new RAPIER.Vector3(0, 0, 0);
/** Buzzar: spawned objects leave your hand at this speed (m/s), tilted randomly by up to SPAWN_TOSS_JITTER. */
const SPAWN_TOSS_SPEED = 0.4;
const SPAWN_TOSS_JITTER = (20 * Math.PI) / 180;

// Returns false if the object exceeded the object cap
export function spawnPrefab(
  ctx: GameContext,
  spawnFrom: RemoteNode,
  prefabId: string,
  isXR: boolean,
  variables?: ThingVariables
): boolean {
  const { maxObjectCap } = getModule(ctx, ThirdRoomModule);
  const rules = getSpawnRules(ctx);

  // Buzzar: the world's object rules (other clients enforce them too, so spawning past them is pointless), unless
  // "Ignore world limits for my actions" is on (Developer settings): others still won't see what breaks them.
  const ignoreLimits = getLimitOverrides(ctx).ignoreOwn;
  if (!ignoreLimits && !isSpawnAllowed(rules, prefabId)) return false;
  const limit = ignoreLimits ? Infinity : rules.maxPerUser ?? maxObjectCap;
  const ownedEnts = ownedNetworkedQuery(ctx.world);
  let ownedStock = 0;
  for (let i = 0; i < ownedEnts.length; i++) {
    const prefab = Prefab.get(ownedEnts[i]);
    if (prefab && isThingId(prefab) && !hasComponent(ctx.world, TakenObject, ownedEnts[i])) ownedStock++;
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

  // Buzzar: a cloned Thing's variables (size, colour…), also sent to everyone with the object's create message.
  const checked = variables ? sanitizeThingVariables(prefabId, variables) : undefined;
  const prefab = createPrefabEntity(ctx, prefabId, { variables: checked } satisfies ThingPrefabOptions);
  const eid = prefab.eid;
  if (hasThingVariables(checked)) PrefabCreateData.set(eid, encodeThingVariables(checked));

  addComponent(ctx.world, Owned, eid);
  addComponent(ctx.world, Networked, eid, true);

  mat4.getTranslation(prefab.position, spawnFrom.worldMatrix);

  getRotationNoAlloc(_spawnWorldQuat, spawnFrom.worldMatrix);
  const direction = vec3.set(_direction, 0, 0, -1);
  vec3.transformQuat(direction, direction, _spawnWorldQuat);

  // place object at direction
  const placement = spawnPlacement(prefabId);
  // Buzzar: a Thing made to be carried (HAVEN_thing spawn.held) appears where held things sit, already in your hold.
  const intoHold = !!placement?.held && canHoldSpawned(ctx);
  let distance = intoHold ? HELD_SPAWN_DISTANCE : placement?.distance;
  if (placement?.upright) {
    // Level, facing the way you look (so it lands flat and comes out the same way round each time).
    direction[1] = 0;
    if (vec3.length(direction) < 1e-4) vec3.set(direction, 0, 0, -1);
    vec3.normalize(direction, direction);
    quat.setAxisAngle(_spawnWorldQuat, [0, 1, 0], Math.atan2(-direction[0], -direction[2]));
  }
  // Buzzar: far enough out that it doesn't start round you (a crate cloned at 4× is 10 m across).
  const body0 = prefab.physicsBody?.body;
  const clear = body0 && !intoHold ? bodyReach(body0) + 0.6 : 0;
  if (clear > (distance ?? 1)) distance = clear;
  const spawnDistance = distance ?? vec3.length(direction);
  vec3.copy(_spawnOrigin, prefab.position);
  if (distance !== undefined) vec3.scale(direction, direction, distance);
  vec3.add(prefab.position, prefab.position, direction);
  prefab.quaternion.set(_spawnWorldQuat);
  if (distance !== undefined) vec3.normalize(direction, direction);

  const body = prefab.physicsBody?.body;

  if (!body) {
    console.warn("could not find physics body for spawned entity " + eid);
    return true;
  }

  applyTransformToRigidBody(body, prefab);
  // Third Room #300: don't spawn on the far side of a window or wall you can't throw through. Right up against
  // one, there's no room on your side: spawn nothing rather than inside you.
  const blocked = stopAtObstacle(
    getModule(ctx, PhysicsModule).physicsWorld,
    body,
    _spawnOrigin,
    direction,
    spawnDistance
  );
  if (blocked === "no-room") {
    removeObjectFromWorld(ctx, prefab);
    return true;
  }
  if (blocked === "moved") {
    const t = body.translation();
    vec3.set(prefab.position, t.x, t.y, t.z);
  }
  if (liftClearOfOverlaps(getModule(ctx, PhysicsModule).physicsWorld, body)) {
    const t = body.translation();
    vec3.set(prefab.position, t.x, t.y, t.z);
  }
  // Buzzar: a gentle, slightly random toss, so objects spawned in a row don't all drop along the same path
  // (Third Room #297). One going into your hold stays put.
  vec3.scale(direction, direction, intoHold ? 0 : SPAWN_TOSS_SPEED);
  if (!intoHold) jitterDirection(direction, SPAWN_TOSS_JITTER);
  _spawnVelocity.x = direction[0];
  _spawnVelocity.y = direction[1];
  _spawnVelocity.z = direction[2];
  body.setLinvel(_spawnVelocity, true);

  const privateScene = ctx.worldResource.environment?.privateScene;

  if (!privateScene) {
    throw new Error("private scene not found on environment");
  }

  addObjectToWorld(ctx, prefab);
  if (intoHold) holdSpawnedObject(ctx, eid);

  return true;
}
