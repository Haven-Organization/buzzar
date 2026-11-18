/**
 * Buzzar: custom avatars (game worker).
 *
 * The main thread resolves which avatar each peer wants (Matrix member event / profile field, see
 * src/ui/utils/avatars.ts) and sends SetPeerAvatar. This module loads the file, validates it (humanoid,
 * within limits), retargets the built-in locomotion clips onto its skeleton and swaps it into the peer's
 * player container. Anything that fails keeps the default avatar.
 */
import { hasComponent, removeComponent } from "bitecs";
import { quat } from "gl-matrix";
import { AnimationClip, AnimationUtils, Matrix4, Object3D, Quaternion, Vector3 } from "three";

import { AnimationClipType, AnimationComponent } from "../animation/animation.game";
import { localPosture, Posture } from "../player/posture.common";
import { addChild, removeChild } from "../component/transform";
import { GameContext } from "../GameTypes";
import {
  AnimationPostUpdate,
  GLTFLoaderContext,
  GLTFLoaderOptions,
  loadDefaultGLTFScene,
  loadGLTF,
  loadGLTFAccessor,
} from "../gltf/gltf.game";
import { getAccessorArrayView } from "../common/accessor";
import { defineModule, getModule, registerMessageHandler, Thread } from "../module/module.common";
import { NetworkModule } from "../network/network.game";
import { NetworkAction } from "../network/NetworkAction";
import { registerInboundMessageHandler } from "../network/inbound.game";
import { broadcastReliable } from "../network/outbound.game";
import { writeMetadata } from "../network/serialization.game";
import { createCursorView, sliceCursorView } from "../allocator/CursorView";
import { applyAvatarLayers, isAvatarHiddenFromMainCamera, setAvatarHiddenFromMainCamera } from "../player/avatarLayers";
import { AvatarRef } from "../player/components";
import { getCamera } from "../player/getCamera";
import { getNametag } from "../player/nametags.game";
import { OurPlayer, ourPlayerQuery, playerQuery } from "../player/Player";
import { LipSyncMessageType, lipSyncVoices, LOCAL_VOICE, onLipSyncMessage } from "../audio/lipsync.common";
import { RemoteNode } from "../resource/RemoteResources";
import { getRemoteResource } from "../resource/resource.game";
import {
  AnnounceAvatarChangeMessage,
  AvatarStatusMessage,
  AvatarStatusMessageType,
  LOCAL_AVATAR_PEER,
  PeerAvatarChangedMessage,
  PeerAvatarChangedMessageType,
  SetPeerAvatarMessage,
  SetPeerAvatarMessageType,
} from "./avatar.common";
import { checkAvatarLimits, computeAvatarStats, getHumanoidMapping, HumanoidMapping, HumanBone } from "./humanoid";
import { createSpringRig, getSpringChains, SpringRig, updateSpringRig } from "./springBones";
import { createFaceRig, FaceRig, getFaceSpec, updateFaceRig } from "./face";
import {
  applyBindPose,
  buildPoseClip,
  buildCrawlClip,
  buildClimbClip,
  buildCrouchWalkClip,
  buildSitClip,
  CROUCH_POSE,
  PRONE_POSE,
  captureRestTransforms,
  estimateEyeHeight,
  retargetClip,
  narrowLegSpread,
  shortenStride,
  RetargetRig,
} from "./retarget";
import {
  hideAvatarPlaceholder,
  hideRigWhileLoading,
  isAvatarLoading,
  setAvatarPlaceholderProgress,
  showAvatarPlaceholder,
} from "./placeholder.game";

export const DEFAULT_AVATAR_URL = "/gltf/full-animation-rig.glb";
const NAMETAG_ABOVE_EYES = 0.35;
/** Matches the default rig's camera anchor (AVATAR_HEIGHT - camera offset in PlayerRig.ts). */
const DEFAULT_EYE_HEIGHT = 1.64;
const MIN_EYE_HEIGHT = 0.2;
const MAX_EYE_HEIGHT = 5;

/**
 * Each loaded avatar rig's hips bone node (keyed by the rig node). Seats use it to put the hips on the cushion
 * whatever the avatar's proportions.
 */
export const AvatarHips = new WeakMap<RemoteNode, RemoteNode>();

function hipsNodeFor(loaderCtx: GLTFLoaderContext, mapping: HumanoidMapping): RemoteNode | undefined {
  const index = mapping.bones.get("hips");
  return index === undefined ? undefined : loaderCtx.nodeMap.get(index);
}

/**
 * Loads the built-in default avatar into a new rig node with its own clips plus the procedural Sit clip.
 * Used for the player prefab (before any custom avatar is applied) and when switching back to the default.
 */
export function createDefaultAvatarNode(ctx: GameContext, onLoaded?: (rig: RemoteNode) => void): RemoteNode {
  const rig = new RemoteNode(ctx.resourceManager);
  loadGLTF(ctx, DEFAULT_AVATAR_URL).then((resource) => {
    loadDefaultGLTFScene(ctx, resource, { ...defaultAvatarOptions(ctx, resource, rig), existingNode: rig });
    onLoaded?.(rig);
  });
  return rig;
}

function defaultAvatarOptions(
  ctx: GameContext,
  resource: Awaited<ReturnType<typeof loadGLTF>>,
  rig: RemoteNode
): GLTFLoaderOptions {
  return {
    extraAnimationClips: (loaderCtx, rootObj, ownClips) => {
      const mapping = getHumanoidMapping(resource.root);
      if (!mapping) return [];
      const hips = hipsNodeFor(loaderCtx, mapping);
      if (hips) AvatarHips.set(rig, hips);
      const own = buildRetargetRig(loaderCtx, rootObj, mapping, new Quaternion());
      fixSourceClips(ownClips, own);
      return makeCrouchAdditive([...ownClips, buildSitClip(own), ...buildPostureClips(own)], own).filter(
        (clip) => !ownClips.includes(clip)
      );
    },
    createAnimationPostUpdate: (loaderCtx, rootObj) => {
      const mapping = getHumanoidMapping(resource.root);
      return mapping ? createAvatarAnimationExtras(ctx, loaderCtx, rootObj, mapping) : undefined;
    },
  };
}

/** Standing and moving clips whose leg shape is corrected per avatar (not sitting, crouching, crawling, climbing). */
const LOCOMOTION_CLIPS = new Set([
  "Idle",
  "Walk",
  "WalkBack",
  "Run",
  "RunBack",
  "StrafeLeft",
  "StrafeRight",
  "StrafeLeftRun",
  "StrafeRightRun",
  "TurnLeft",
  "TurnRight",
]);

/** Clips already corrected (the same clip objects can come back on a later load). */
const fixedClips = new WeakSet<AnimationClip>();

/**
 * Buzzar: corrections to the built-in locomotion clips, before they play on the default avatar or are retargeted:
 * running backwards keeps its legs together (the clip splays them sideways and scissors them very wide front to
 * back, an upside-down V).
 */
function fixSourceClips(clips: AnimationClip[], rig: RetargetRig) {
  for (const clip of clips) {
    if (fixedClips.has(clip)) continue;
    fixedClips.add(clip);
    if (clip.name === "RunBack") {
      narrowLegSpread(clip, rig);
      shortenStride(clip, rig);
    }
  }
}

interface SourceRig {
  rig: RetargetRig;
  clips: AnimationClip[];
}

interface DesiredAvatar {
  /** undefined = default avatar */
  url?: string;
  name?: string;
}

/** How long to show "Looking up avatar…" for a newly joined player before falling back to the default. */
const LOOKUP_TIMEOUT_MS = 15_000;
const ERROR_DISPLAY_MS = 4_000;
const MAX_AVATAR_RETRIES = 3;
const AVATAR_RETRY_BASE_MS = 5_000;

interface AvatarModuleState {
  /** peerId → avatar the main thread resolved for them */
  desired: Map<string, DesiredAvatar>;
  /** container → url currently applied or being loaded (undefined = default) */
  applied: WeakMap<RemoteNode, string | undefined>;
  /** containers with a swap in flight */
  loading: WeakSet<RemoteNode>;
  /** Failed loads per container, for retrying with backoff. */
  failures: WeakMap<RemoteNode, { url: string | undefined; attempts: number }>;
  /** containers waiting for the main thread to resolve their avatar → since when */
  lookupSince: WeakMap<RemoteNode, number>;
  sourceRig?: Promise<SourceRig>;
}

export const AvatarModule = defineModule<GameContext, AvatarModuleState>({
  name: "avatar",
  create() {
    return {
      desired: new Map(),
      applied: new WeakMap(),
      loading: new WeakSet(),
      failures: new WeakMap(),
      lookupSince: new WeakMap(),
    };
  },
  init(ctx) {
    const disposeAvatar = registerMessageHandler(ctx, SetPeerAvatarMessage, onSetPeerAvatar);
    // Debug: `thirdroom.blink(1)` holds every avatar's eyes closed, `(0)` open, `()` back to normal blinking.
    const disposeBlink = registerMessageHandler(
      ctx,
      BlinkDebugMessage,
      (_ctx: GameContext, message: { type: typeof BlinkDebugMessage; closed: number }) => {
        forcedBlink = message.closed >= 0 ? message.closed : undefined;
      }
    );
    const disposeLipSync = registerMessageHandler(ctx, LipSyncMessageType, onLipSyncMessage);
    // Avatar changes reach other players instantly instead of on their next profile poll (up to a minute).
    const network = getModule(ctx, NetworkModule);
    const disposeAnnounce = registerMessageHandler(ctx, AnnounceAvatarChangeMessage, (ctx: GameContext) => {
      writeMetadata(announceView, NetworkAction.HavenAvatarChanged);
      broadcastReliable(ctx, network, sliceCursorView(announceView));
    });
    registerInboundMessageHandler(network, NetworkAction.HavenAvatarChanged, (ctx, _v, peerId) => {
      const avatars = getModule(ctx, AvatarModule);
      // Forget what we had: AvatarSystem shows "Looking up avatar…" until the new one is resolved and loads.
      avatars.desired.delete(peerId);
      const container = findContainer(ctx, peerId);
      if (container) avatars.lookupSince.delete(container);
      ctx.sendMessage<PeerAvatarChangedMessageType>(Thread.Main, { type: PeerAvatarChangedMessage, peerId });
    });
    // Debug: `thirdroom.mouth(0.8)` opens every avatar's mouth ("aa"), `thirdroom.mouth(v, "ou")` another shape,
    // `thirdroom.mouth()` back to lip sync.
    const disposeMouth = registerMessageHandler(
      ctx,
      MouthDebugMessage,
      (_ctx: GameContext, message: { type: typeof MouthDebugMessage; amount: number; viseme: number }) => {
        if (message.amount < 0) {
          forcedVisemes = undefined;
        } else {
          forcedVisemes = new Float32Array(5);
          forcedVisemes[Math.max(0, Math.min(4, message.viseme))] = message.amount;
        }
      }
    );
    return () => {
      disposeAvatar();
      disposeBlink();
      disposeLipSync();
      disposeAnnounce();
      disposeMouth();
    };
  },
});

function onSetPeerAvatar(ctx: GameContext, message: SetPeerAvatarMessageType) {
  getModule(ctx, AvatarModule).desired.set(message.peerId, { url: message.url, name: message.name });
}

/** The avatar URL currently shown (or loading) for a player container; undefined = default avatar. */
export function getAppliedAvatarUrl(ctx: GameContext, container: RemoteNode): string | undefined {
  return getModule(ctx, AvatarModule).applied.get(container);
}

function sendStatus(ctx: GameContext, status: Omit<AvatarStatusMessageType, "type">) {
  ctx.sendMessage<AvatarStatusMessageType>(Thread.Main, { type: AvatarStatusMessage, ...status });
}

function findContainer(ctx: GameContext, peerId: string): RemoteNode | undefined {
  const network = getModule(ctx, NetworkModule);
  let eid = network.peerIdToEntityId.get(peerId);
  if (eid === undefined && (peerId === LOCAL_AVATAR_PEER || peerId === network.peerId)) {
    eid = ourPlayerQuery(ctx.world)[0];
  }
  if (eid === undefined) return undefined;
  const node = getRemoteResource<RemoteNode>(ctx, eid);
  return node && AvatarRef.eid[node.eid] ? node : undefined;
}

export function AvatarSystem(ctx: GameContext) {
  const avatars = getModule(ctx, AvatarModule);
  const network = getModule(ctx, NetworkModule);
  const now = performance.now();

  // Players whose avatar we haven't resolved yet (just joined): show the placeholder while we look it up.
  for (const [peerId, eid] of network.peerIdToEntityId) {
    if (avatars.desired.has(peerId)) continue;
    const container = getRemoteResource<RemoteNode>(ctx, eid);
    if (!container || !AvatarRef.eid[container.eid]) continue;
    const since = avatars.lookupSince.get(container);
    if (since === undefined) {
      avatars.lookupSince.set(container, now);
      showAvatarPlaceholder(ctx, container, "Loading avatar");
      setAvatarPlaceholderProgress(container, undefined, "Looking up avatar…");
    } else if (now - since > LOOKUP_TIMEOUT_MS && isAvatarLoading(container) && !avatars.loading.has(container)) {
      hideAvatarPlaceholder(ctx, container); // give up and keep the default avatar
    }
  }

  for (const [peerId, { url, name }] of avatars.desired) {
    const container = findContainer(ctx, peerId);
    if (!container) continue;
    const current = avatars.applied.has(container) ? avatars.applied.get(container) : undefined;
    if (current === url) {
      // Resolved to what's already shown (e.g. the default avatar): drop a lookup placeholder.
      if (!avatars.loading.has(container) && isAvatarLoading(container) && avatars.lookupSince.has(container)) {
        avatars.lookupSince.delete(container);
        hideAvatarPlaceholder(ctx, container);
      }
      continue;
    }

    avatars.applied.set(container, url);
    avatars.loading.add(container);
    avatars.lookupSince.delete(container);
    swapAvatar(ctx, peerId, container, url, name)
      .catch((error) => {
        console.error(`Failed to load avatar for ${peerId}:`, error);
        sendStatus(ctx, { peerId, url, status: "error", reason: String(error?.message ?? error) });
        // Buzzar: retry failed downloads (dropped connections, server hiccups) a few times with backoff instead
        // of leaving the default avatar for the rest of the session.
        const failure = avatars.failures.get(container);
        const attempts = failure && failure.url === url ? failure.attempts + 1 : 1;
        avatars.failures.set(container, { url, attempts });
        const retrying = attempts <= MAX_AVATAR_RETRIES;
        setAvatarPlaceholderProgress(
          container,
          undefined,
          retrying ? "Couldn't load, retrying…" : "Couldn't load this avatar"
        );
        hideAvatarPlaceholder(ctx, container, ERROR_DISPLAY_MS);
        if (retrying) {
          setTimeout(() => {
            // Forget it was applied so the next AvatarSystem pass loads it again (if still wanted).
            if (avatars.applied.get(container) === url && !avatars.loading.has(container)) {
              avatars.applied.delete(container);
            }
          }, AVATAR_RETRY_BASE_MS * 2 ** (attempts - 1));
        }
      })
      .finally(() => {
        if (avatars.applied.get(container) === url) avatars.loading.delete(container);
      });
  }
}

function loadIntoNode(
  ctx: GameContext,
  resource: Awaited<ReturnType<typeof loadGLTF>>,
  options?: GLTFLoaderOptions
): RemoteNode {
  const node = new RemoteNode(ctx.resourceManager);
  loadDefaultGLTFScene(ctx, resource, { ...options, existingNode: node });
  return node;
}

// --- Rig building -------------------------------------------------------------------------------

const Y180 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);

function buildRetargetRig(
  loaderCtx: GLTFLoaderContext,
  rootObj: Object3D,
  mapping: HumanoidMapping,
  align: Quaternion
): RetargetRig {
  const bones = new Map<HumanBone, Object3D>();
  for (const [bone, nodeIndex] of mapping.bones) {
    const node = loaderCtx.nodeMap.get(nodeIndex);
    const obj = node && loaderCtx.nodeToObject3D.get(node);
    if (obj) bones.set(bone, obj);
  }
  const rest = captureRestTransforms(rootObj);
  applyBindPose(rest, rootObj, getJointBindWorldMatrices(loaderCtx, rootObj));
  return { root: rootObj, bones, rest, align };
}

/**
 * Bind pose of every skin joint relative to the rig root.
 *
 * Per the glTF spec, bindWorld = meshWorld · IBM⁻¹. Some exporters (including the one that produced the
 * built-in rig) write IBMs that ignore the mesh node's own transform, i.e. bindWorld = IBM⁻¹. Both appear in
 * the wild, so for each skin we pick whichever interpretation puts the joints closest to their node
 * positions (node rotations may be posed, but positions are close to the bind pose).
 */
function getJointBindWorldMatrices(loaderCtx: GLTFLoaderContext, rootObj: Object3D): Map<Object3D, Matrix4> {
  const { root } = loaderCtx.resource;
  const result = new Map<Object3D, Matrix4>();
  const objectForNode = (index: number) => {
    const node = loaderCtx.nodeMap.get(index);
    return node ? loaderCtx.nodeToObject3D.get(node) : undefined;
  };

  rootObj.updateMatrixWorld(true);
  const rootInverse = new Matrix4().copy(rootObj.matrixWorld).invert();
  const nodeWorld = (obj: Object3D) => new Matrix4().copy(rootInverse).multiply(obj.matrixWorld);
  const position = new Vector3();
  const nodePosition = new Vector3();

  (root.skins ?? []).forEach((skin, skinIndex) => {
    if (skin.inverseBindMatrices === undefined) return;
    const meshNodeIndex = (root.nodes ?? []).findIndex((node) => node.skin === skinIndex);
    const meshObj = meshNodeIndex >= 0 ? objectForNode(meshNodeIndex) : undefined;
    const meshWorld = meshObj ? nodeWorld(meshObj) : new Matrix4();

    const ibms = getAccessorArrayView(loadGLTFAccessor(loaderCtx.resource, skin.inverseBindMatrices)) as Float32Array;
    const joints: { obj: Object3D; spec: Matrix4; worldSpace: Matrix4 }[] = [];
    let specError = 0;
    let worldSpaceError = 0;

    skin.joints.forEach((jointIndex, j) => {
      const obj = objectForNode(jointIndex);
      if (!obj || result.has(obj)) return;
      const inverseIbm = new Matrix4().fromArray(ibms, j * 16).invert();
      const spec = meshWorld.clone().multiply(inverseIbm);
      nodePosition.setFromMatrixPosition(nodeWorld(obj));
      specError += position.setFromMatrixPosition(spec).distanceTo(nodePosition);
      worldSpaceError += position.setFromMatrixPosition(inverseIbm).distanceTo(nodePosition);
      joints.push({ obj, spec, worldSpace: inverseIbm });
    });

    const useSpec = specError <= worldSpaceError;
    for (const joint of joints) result.set(joint.obj, useSpec ? joint.spec : joint.worldSpace);
  });

  return result;
}

/** Loads the built-in Mixamo rig once, keeping its clips + rest pose as the retargeting source. */
function getSourceRig(ctx: GameContext): Promise<SourceRig> {
  const avatars = getModule(ctx, AvatarModule);
  if (!avatars.sourceRig) {
    avatars.sourceRig = (async () => {
      const resource = await loadGLTF(ctx, DEFAULT_AVATAR_URL);
      const mapping = getHumanoidMapping(resource.root);
      if (!mapping) throw new Error("default avatar has no humanoid rig");

      let captured: SourceRig | undefined;
      const template = loadIntoNode(ctx, resource, {
        extraAnimationClips: (loaderCtx, rootObj, ownClips) => {
          const rig = buildRetargetRig(loaderCtx, rootObj, mapping, new Quaternion());
          fixSourceClips(ownClips, rig);
          // The Sit pose is built on the source rig so it retargets to every avatar like the locomotion clips.
          captured = { rig, clips: [...ownClips, buildSitClip(rig), ...buildPostureClips(rig)] };
          return [];
        },
      });

      // The template is never added to the world; stop the animation system from driving it.
      template.visible = false;
      removeComponent(ctx.world, AnimationComponent, template.eid);

      if (!captured) throw new Error("default avatar animations were not built");
      return captured;
    })();
  }
  return avatars.sourceRig;
}

// --- Swapping ------------------------------------------------------------------------------------

type LoadProgress = (progress: number | undefined, status: string) => void;

async function loadCustomAvatar(
  ctx: GameContext,
  url: string,
  onProgress?: LoadProgress
): Promise<{ rig: RemoteNode; eyeHeight?: number }> {
  const source = await getSourceRig(ctx);
  onProgress?.(0, "Downloading…");
  const resource = await loadGLTF(ctx, url, {
    onProgress: (loaded, total) =>
      onProgress?.(
        total > 0 ? loaded / total : undefined,
        total > 0
          ? `Downloading ${Math.round((loaded / total) * 100)}% (${(total / 1048576).toFixed(1)} MB)`
          : `Downloading ${(loaded / 1048576).toFixed(1)} MB`
      ),
  });
  onProgress?.(1, "Preparing avatar…");
  // Let a frame go out so the "Preparing" stage is visible before the (blocking) parse + retarget.
  await new Promise((resolve) => setTimeout(resolve, 50));

  let fileBytes = 0;
  for (const buffer of resource.buffers.values()) fileBytes += buffer.byteLength;
  const reasons = checkAvatarLimits(computeAvatarStats(resource.root, fileBytes));
  if (reasons.length > 0) throw new AvatarRejectedError(`over limits: ${reasons.join(", ")}`);

  const mapping = getHumanoidMapping(resource.root);
  if (!mapping) throw new AvatarRejectedError("not a humanoid avatar (no VRM, Mixamo or CATS bone names found)");

  let eyeHeight: number | undefined;
  let hips: RemoteNode | undefined;
  const rig = loadIntoNode(ctx, resource, {
    extraAnimationClips: (loaderCtx, rootObj) => {
      hips = hipsNodeFor(loaderCtx, mapping);
      const target = buildRetargetRig(loaderCtx, rootObj, mapping, mapping.facesNegativeZ ? Y180 : new Quaternion());
      eyeHeight = estimateEyeHeight({ ...target, align: new Quaternion() });
      // Avatars bound in an A-pose (common for game and VRChat models) get their limbs corrected to the clips' T-pose.
      const clips = source.clips.map((clip) => retargetClip(clip, source.rig, target, { normalizeRestPose: true }));
      // Buzzar: avatars that stand with their ankles wider than their knees would walk and run knees-in, ankles-out:
      // line each shin up with its thigh.
      for (const clip of clips) {
        if (LOCOMOTION_CLIPS.has(clip.name)) narrowLegSpread(clip, target, 1, { thighs: false, shinsToThighs: true });
      }
      return makeCrouchAdditive(clips, target);
    },
    // Hair, ears, tails, skirts…: built after retargeting has put the skeleton in its bind pose (the springs' rest).
    createAnimationPostUpdate: (loaderCtx, rootObj) => createAvatarAnimationExtras(ctx, loaderCtx, rootObj, mapping),
  });

  // Mixamo / VRM 1.0 face +Z and need turning to face the player's forward (-Z); VRM 0.x already faces -Z.
  if (!mapping.facesNegativeZ) quat.fromEuler(rig.quaternion, 0, 180, 0);
  if (hips) AvatarHips.set(rig, hips);

  return { rig, eyeHeight };
}

export class AvatarRejectedError extends Error {}

/** Crouch and Prone poses (plugins/posture), built on a rig facing +Z like the Sit clip. */
function buildPostureClips(rig: RetargetRig): AnimationClip[] {
  try {
    return [
      buildPoseClip(rig, AnimationClipType.Crouch, CROUCH_POSE),
      buildPoseClip(rig, AnimationClipType.Prone, PRONE_POSE),
      buildCrawlClip(rig, AnimationClipType.Crawl),
      buildCrouchWalkClip(rig, AnimationClipType.CrouchWalk),
      buildCrouchWalkClip(rig, AnimationClipType.CrouchStrafe, 1.0, true),
      buildClimbClip(rig, AnimationClipType.Climb),
    ];
  } catch (error) {
    // Optional poses: never fail the avatar over them.
    console.warn("Avatar crouch/prone poses unavailable:", error);
    return [];
  }
}

/** Bones the crouch layer moves; the arms keep whatever the locomotion clip does. */
const CROUCH_LAYER_BONES: HumanBone[] = [
  "hips", "spine", "chest", "upperChest", "neck", "head",
  "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes", "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes",
]; // prettier-ignore

/**
 * Turns the Crouch pose into an additive layer: its difference from the avatar's Idle pose (so rest-pose fixes such
 * as A-pose arms cancel out), on the hips, spine and legs only. Played on top of idle/walking, the avatar walks
 * crouched.
 */
function makeCrouchAdditive(clips: AnimationClip[], rig: RetargetRig): AnimationClip[] {
  const crouch = clips.find((c) => c.name === AnimationClipType.Crouch);
  const idle = clips.find((c) => c.name === AnimationClipType.Idle);
  if (!crouch) return clips;
  const allowed = new Set(CROUCH_LAYER_BONES.map((b) => rig.bones.get(b)?.uuid).filter((u): u is string => !!u));
  const reference = idle ?? crouch;
  const referenceNames = new Set(reference.tracks.map((t) => t.name));
  crouch.tracks = crouch.tracks.filter(
    (t) => allowed.has(t.name.slice(0, t.name.lastIndexOf("."))) && (idle ? referenceNames.has(t.name) : true)
  );
  if (!idle) return clips.filter((c) => c !== crouch); // nothing to layer on
  try {
    AnimationUtils.makeClipAdditive(crouch, 0, idle);
  } catch (error) {
    console.warn("Avatar crouch layer unavailable:", error);
    return clips.filter((c) => c !== crouch);
  }
  return clips;
}

/**
 * Secondary motion and face for an avatar: spring bones (hair, ears…), then blinking and eye gaze. Built once the
 * animation graph is in its bind pose; runs every frame right after the mixer.
 */
function createAvatarAnimationExtras(
  ctx: GameContext,
  loaderCtx: GLTFLoaderContext,
  rootObj: Object3D,
  mapping: HumanoidMapping
): AnimationPostUpdate | undefined {
  const objectFor = (index: number) => {
    const node = loaderCtx.nodeMap.get(index);
    return node ? loaderCtx.nodeToObject3D.get(node) : undefined;
  };

  let springRig: SpringRig | undefined;
  try {
    const chains = getSpringChains(loaderCtx.resource.root, mapping);
    if (chains.length > 0) springRig = createSpringRig(chains, objectFor, { facesNegativeZ: mapping.facesNegativeZ });
  } catch (error) {
    // Decoration only: never fail the avatar over it.
    console.warn("Avatar spring bones disabled:", error);
  }

  let faceRig: FaceRig | undefined;
  try {
    rootObj.updateMatrixWorld(true);
    const gltfNodes = loaderCtx.resource.root.nodes ?? [];
    const spec = getFaceSpec(
      loaderCtx.resource.root,
      mapping,
      (i) => {
        const obj = objectFor(i);
        return obj ? new Vector3().setFromMatrixPosition(obj.matrixWorld) : undefined;
      },
      (i, offset) => {
        // The graph root is still at the origin here, so world space is avatar space.
        const obj = objectFor(i);
        const parent = obj?.parent;
        if (!obj || !parent) return undefined;
        const from = new Vector3().setFromMatrixPosition(obj.matrixWorld);
        const to = parent.worldToLocal(from.clone().add(offset));
        return to.sub(parent.worldToLocal(from));
      }
    );
    faceRig = createFaceRig({
      spec,
      objectFor,
      facesNegativeZ: mapping.facesNegativeZ,
      weightsFor: (bind) => {
        const out: Float32Array[] = [];
        const add = (index: number) => {
          const weights = loaderCtx.nodeMap.get(index)?.morphWeights?.weights;
          if (weights && bind.index < weights.length) out.push(weights);
        };
        if (bind.node !== undefined) add(bind.node);
        else gltfNodes.forEach((n, i) => n.mesh === bind.mesh && add(i));
        return out;
      },
    });
  } catch (error) {
    console.warn("Avatar face animation disabled:", error);
  }

  if (!springRig && !faceRig) return undefined;
  return (dt, rootWorldMatrix, node) => {
    if (springRig) updateSpringRig(springRig, rootObj, rootWorldMatrix, dt);
    else syncRootMatrix(rootObj, rootWorldMatrix);
    if (faceRig) {
      faceRig.forceBlink = forcedBlink;
      const visemes = faceRig.hasMouth ? forcedVisemes ?? voiceFor(ctx, node) : undefined;
      updateFaceRig(faceRig, dt, getLookTargets(ctx), Math.random, visemes);
    }
  };
}

/** The lip sync shapes for whoever wears this avatar: your microphone for your own, the peer's voice otherwise. */
function voiceFor(ctx: GameContext, avatarNode: RemoteNode): Float32Array | undefined {
  const container = avatarNode.parent;
  if (!container) return undefined;
  if (hasComponent(ctx.world, OurPlayer, container.eid)) return lipSyncVoices.get(LOCAL_VOICE);
  return container.name ? lipSyncVoices.get(container.name) : undefined;
}

const announceView = createCursorView(new ArrayBuffer(64));
const BlinkDebugMessage = "software.haven.debug.blink";
let forcedBlink: number | undefined;
const MouthDebugMessage = "software.haven.debug.mouth";
let forcedVisemes: Float32Array | undefined;

/** Puts the avatar's world matrix on the animation graph root and updates the graph's world matrices. */
function syncRootMatrix(root: Object3D, rootWorldMatrix: ArrayLike<number>) {
  root.matrixAutoUpdate = false;
  root.matrix.fromArray(rootWorldMatrix as number[]);
  root.updateMatrixWorld(true);
}

/** Default eye height when a player's isn't known (metres above their feet). */
const DEFAULT_LOOK_HEIGHT = 1.5;
let lookTargetsAt = -1;
const lookTargets: Float32Array[] = [];

/** World positions of every player's eyes, computed once per frame. */
function getLookTargets(ctx: GameContext): Float32Array[] {
  if (lookTargetsAt === ctx.elapsed) return lookTargets;
  lookTargetsAt = ctx.elapsed;
  lookTargets.length = 0;
  for (const eid of playerQuery(ctx.world)) {
    const node = getRemoteResource<RemoteNode>(ctx, eid);
    if (!node) continue;
    let height = DEFAULT_LOOK_HEIGHT;
    try {
      height = getNametag(ctx, node).position[1] - NAMETAG_ABOVE_EYES;
    } catch {
      // our own player (no name tag)
    }
    const m = node.worldMatrix;
    lookTargets.push(new Float32Array([m[12], m[13] + height, m[14]]));
  }
  return lookTargets;
}

/**
 * Loads an avatar (or the built-in default when `url` is undefined) as a rig node facing -Z, with retargeted
 * locomotion clips. Throws AvatarRejectedError for files that aren't usable avatars.
 */
export async function loadAvatarRig(
  ctx: GameContext,
  url: string | undefined,
  onProgress?: LoadProgress
): Promise<{ rig: RemoteNode; eyeHeight?: number }> {
  if (url) return loadCustomAvatar(ctx, url, onProgress);
  const resource = await loadGLTF(ctx, DEFAULT_AVATAR_URL);
  const rig = new RemoteNode(ctx.resourceManager);
  loadDefaultGLTFScene(ctx, resource, { ...defaultAvatarOptions(ctx, resource, rig), existingNode: rig });
  quat.fromEuler(rig.quaternion, 0, 180, 0);
  return { rig, eyeHeight: DEFAULT_EYE_HEIGHT };
}

async function swapAvatar(
  ctx: GameContext,
  peerId: string,
  container: RemoteNode,
  url: string | undefined,
  name: string | undefined
) {
  const avatars = getModule(ctx, AvatarModule);
  const stillWanted = () =>
    avatars.applied.get(container) === url && getRemoteResource(ctx, container.eid) === container;

  if (url) {
    showAvatarPlaceholder(ctx, container, name ? `Loading ${name}` : "Loading avatar");
  }
  const onProgress: LoadProgress = (progress, status) => {
    if (stillWanted()) setAvatarPlaceholderProgress(container, progress, status);
  };

  let rig: RemoteNode;
  let eyeHeight: number | undefined;

  try {
    ({ rig, eyeHeight } = await loadAvatarRig(ctx, url, onProgress));
  } catch (error) {
    if (error instanceof AvatarRejectedError) {
      sendStatus(ctx, { peerId, url, status: "rejected", reason: error.message });
      if (stillWanted()) {
        setAvatarPlaceholderProgress(container, undefined, `Avatar hidden: ${error.message}`);
        hideAvatarPlaceholder(ctx, container, ERROR_DISPLAY_MS);
      }
      return;
    }
    throw error;
  }

  // The world may have changed (or they switched again) while we were loading.
  if (!stillWanted()) return;

  const oldRig = getRemoteResource<RemoteNode>(ctx, AvatarRef.eid[container.eid]);
  const hidden = oldRig ? isAvatarHiddenFromMainCamera(oldRig) : false;

  addChild(container, rig);
  AvatarRef.eid[container.eid] = rig.eid;
  if (oldRig) {
    rig.visible = oldRig.visible;
    removeChild(container, oldRig);
  }
  setAvatarHiddenFromMainCamera(rig, hidden);
  applyAvatarLayers(rig);

  applyEyeHeight(ctx, container, eyeHeight);
  hideRigWhileLoading(container, rig);
  hideAvatarPlaceholder(ctx, container);

  avatars.failures.delete(container);
  sendStatus(ctx, { peerId, url, status: "loaded" });
}

function applyEyeHeight(ctx: GameContext, container: RemoteNode, eyeHeight: number | undefined) {
  if (eyeHeight === undefined || !Number.isFinite(eyeHeight)) return;
  const height = Math.min(Math.max(eyeHeight, MIN_EYE_HEIGHT), MAX_EYE_HEIGHT);

  try {
    const anchor = getCamera(ctx, container).parent;
    if (anchor) {
      // Our own player: crouching/prone (plugins/posture) eases the camera from this standing height.
      localPosture.standingEye = height;
      if (localPosture.value === Posture.Standing) anchor.position[1] = height;
    }
  } catch {
    // remote players have no camera
  }

  try {
    getNametag(ctx, container).position[1] = height + NAMETAG_ABOVE_EYES;
  } catch {
    // our own player has no nametag
  }
}
