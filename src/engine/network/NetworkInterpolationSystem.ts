import { RigidBody as RapierRigidBody } from "@dimforge/rapier3d-compat";
import { defineQuery, enterQuery, exitQuery, Not } from "bitecs";
import { Vector3, Quaternion } from "three";
import { quat, vec3 } from "gl-matrix";

import { GameContext } from "../GameTypes";
import { GameNetworkState, getPeerIndexFromNetworkId, NetworkModule, ownedPlayerQuery } from "./network.game";
import { Networked, Owned } from "./NetworkComponents";
import { getModule } from "../module/module.common";
import { SPARE_SAMPLES, addEntityToHistorian, getEntityHistory, removeEntityFromHistorian } from "./Historian";
import { advancePlaybackClock, findSamples } from "./playbackClock";
import { addEntityHistory, syncWithHistorian } from "./InterpolationBuffer";
import { getRemoteResource } from "../resource/resource.game";
import { RemoteNode } from "../resource/RemoteResources";
import { OurPlayer } from "../player/Player";

export const remoteEntityQuery = defineQuery([Networked, Not(Owned), Not(OurPlayer)]);

export const enteredRemoteEntityQuery = enterQuery(remoteEntityQuery);
export const exitedRemoteEntityQuery = exitQuery(remoteEntityQuery);

const getPeerIdFromEntityId = (network: GameNetworkState, eid: number) => {
  const pidx = getPeerIndexFromNetworkId(Networked.networkId[eid]);
  const peerId = network.indexToPeerId.get(pidx) || network.entityIdToPeerId.get(eid);
  return peerId;
};

const _vec = new Vector3();
const _quat = new Quaternion();

const _v3 = vec3.create();
const _q = quat.create();

export function NetworkInterpolationSystem(ctx: GameContext) {
  const network = getModule(ctx, NetworkModule);

  const haveConnectedPeers = network.peers.length > 0;
  const spawnedPlayerRig = ownedPlayerQuery(ctx.world).length > 0;

  if (!haveConnectedPeers || !spawnedPlayerRig) {
    return;
  }

  const entered = enteredRemoteEntityQuery(ctx.world);
  for (let i = 0; i < entered.length; i++) {
    const eid = entered[i];
    const node = getRemoteResource<RemoteNode>(ctx, eid);
    const body = node?.physicsBody?.body;

    if (node) {
      applyNetworkedToEntity(node, body);

      // add to historian
      const pidx = getPeerIndexFromNetworkId(Networked.networkId[eid]);
      const peerId = network.indexToPeerId.get(pidx);

      if (!peerId) {
        throw new Error("peer not found for entity " + eid + " peerIndex " + pidx);
      }
      const historian = network.peerIdToHistorian.get(peerId);
      if (!historian) {
        throw new Error("historian not found for peer " + peerId);
      }
      addEntityToHistorian(historian, eid);
    }
  }

  preprocessHistorians(ctx, network);

  // lerp rigidbody towards network transform for remote networked entities
  const entities = remoteEntityQuery(ctx.world);
  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    const node = getRemoteResource<RemoteNode>(ctx, eid);

    if (!node) {
      console.warn("could not find node for:", eid);
      continue;
    }

    const body = node.physicsBody?.body;

    if (!network.interpolate) {
      applyNetworkedToEntity(node, body);
      continue;
    }

    const peerId = getPeerIdFromEntityId(network, eid);
    if (peerId === undefined) {
      console.warn("could not find peerId for:", eid);
      continue;
    }

    const historian = network.peerIdToHistorian.get(peerId);
    if (historian === undefined) {
      console.warn("could not find historian for:", peerId);
      applyNetworkedToEntity(node, body);
      // console.warn("could not find historian for:", peerId);
      continue;
    }

    const position = node.position;
    const quaternion = node.quaternion;
    const velocity = node.physicsBody?.velocity;

    const netPosition = Networked.position[eid];
    const netVelocity = Networked.velocity[eid];
    const netQuaternion = Networked.quaternion[eid];

    // Buzzar: an object that changed hands mid-flight may not be in its new owner's history yet.
    if (!historian.entities.has(eid)) {
      addEntityToHistorian(historian, eid);
      applyNetworkedToEntity(node, body);
      continue;
    }
    const history = getEntityHistory(historian, eid);

    if (historian.needsUpdate) {
      // append current network values to interpolation buffer
      addEntityHistory(history, netPosition, netVelocity, netQuaternion);
    }

    // drop old history
    syncWithHistorian(history, historian);

    if (historian.fromIndex === -1) {
      continue;
    }

    // Buzzar (Third Room #237): between the two samples around this peer's playback time (see playbackClock.ts). An
    // object that arrived since those samples has no history that far back yet: it's shown as it is now.
    const from = historian.fromIndex;
    const to = historian.toIndex;
    const t = historian.fractionOfTimePassed;
    const pFrom = history.position[from];
    const pTo = history.position[to];
    const vFrom = history.velocity[from];
    const vTo = history.velocity[to];
    const qFrom = history.quaternion[from];
    const qTo = history.quaternion[to];
    if (!pFrom || !pTo || !vFrom || !vTo || !qFrom || !qTo) {
      applyNetworkedToEntity(node, body);
      continue;
    }

    vec3.lerp(_v3, pFrom, pTo, t);
    if (body) body.setTranslation(_vec.fromArray(_v3), true);
    vec3.copy(position, _v3);

    vec3.lerp(_v3, vFrom, vTo, t);
    if (body && body.isDynamic()) body.setLinvel(_vec.fromArray(_v3), true);
    if (velocity) vec3.copy(velocity, _v3);

    quat.slerp(_q, qFrom, qTo, t);
    if (body) body.setRotation(_quat.fromArray(_q), true);
    quat.copy(quaternion, _q);
  }

  const exited = exitedRemoteEntityQuery(ctx.world);
  for (let i = 0; i < exited.length; i++) {
    const eid = exited[i];
    // remove from historian
    const pidx = getPeerIndexFromNetworkId(Networked.networkId[eid]);
    const peerId = network.indexToPeerId.get(pidx);
    if (!peerId) continue;
    const historian = network.peerIdToHistorian.get(peerId);
    if (!historian) continue;
    removeEntityFromHistorian(historian, eid);
  }

  postprocessHistorians(ctx, network);
}

function preprocessHistorians(ctx: GameContext, network: GameNetworkState) {
  const now = Date.now();
  for (const [, historian] of network.peerIdToHistorian) {
    if (historian.needsUpdate) {
      // add timestamp to historian
      historian.timestamps.unshift(historian.latestTime);
    }

    // Buzzar (Third Room #237): show this peer's state at their playback time, which trails their newest data by a
    // delay fitted to how steadily their packets arrive (see playbackClock.ts). It replaces a fixed 100 ms delay whose
    // clock was reset by every packet, so any jitter made objects jump.
    const playback = advancePlaybackClock(historian.clock, now);
    historian.playbackTime = playback;
    const samples = playback === undefined ? undefined : findSamples(historian.timestamps, playback);
    if (!samples) {
      historian.fromIndex = historian.toIndex = -1;
      continue;
    }
    historian.fromIndex = samples.from;
    historian.toIndex = samples.to;
    historian.fractionOfTimePassed = samples.fraction;
    historian.latency = historian.timestamps[0] - (playback ?? historian.timestamps[0]);

    // Older samples aren't needed again (playback only moves forward).
    if (historian.timestamps.length > samples.from + 1 + SPARE_SAMPLES) {
      historian.timestamps.splice(samples.from + 1 + SPARE_SAMPLES);
    }
  }
}

function postprocessHistorians(ctx: GameContext, network: GameNetworkState) {
  for (const [, historian] of network.peerIdToHistorian) {
    historian.needsUpdate = false;
  }
}

export function applyNetworkedToEntity(node: RemoteNode, body?: RapierRigidBody) {
  const eid = node.eid;
  const netPosition = Networked.position[eid];
  const netQuaternion = Networked.quaternion[eid];
  const netVelocity = Networked.velocity[eid];

  node.position.set(netPosition);
  node.quaternion.set(netQuaternion);

  if (node.physicsBody && body) {
    body.setTranslation(_vec.fromArray(netPosition), true);
    if (body.isDynamic()) body.setLinvel(_vec.fromArray(netVelocity), true);
    node.physicsBody.velocity.set(netVelocity);
    body.setRotation(_quat.fromArray(netQuaternion), true);
  }
}
