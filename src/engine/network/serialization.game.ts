import { addComponent, entityExists, hasComponent } from "bitecs";

import {
  createCursorView,
  CursorView,
  moveCursorView,
  readArrayBuffer,
  readFloat32,
  readFloat64,
  readString,
  readUint16,
  readUint32,
  readUint8,
  rewindCursorView,
  scrollCursorView,
  sliceCursorView,
  spaceUint16,
  spaceUint32,
  writeArrayBuffer,
  writeFloat32,
  writeFloat64,
  writePropIfChanged,
  writeScalarPropIfChanged,
  writeString,
  writeUint32,
  writeUint8,
} from "../allocator/CursorView";
import { NOOP } from "../config.common";
import { GameContext } from "../GameTypes";
import { getModule } from "../module/module.common";
import { Prefab, PrefabCreateData, createPrefabEntity, hasPrefabTemplate } from "../prefab/prefab.game";
import { checkBitflag } from "../utils/checkBitflag";
import {
  ownedNetworkedQuery,
  createdOwnedNetworkedQuery,
  GameNetworkState,
  deletedOwnedNetworkedQuery,
  associatePeerWithEntity,
} from "./network.game";
import { Networked } from "./NetworkComponents";
import { NetworkModule } from "./network.game";
import { NetworkAction } from "./NetworkAction";
import { waitUntil } from "../utils/waitUntil";
import { getRemoteResource, tryGetRemoteResource } from "../resource/resource.game";
import { addObjectToWorld, RemoteNode, removeObjectFromWorld } from "../resource/RemoteResources";
import { XRMode } from "../renderer/renderer.common";
import { getReplicator } from "./Replicator";
import { addPlayerFromPeer } from "../player/PlayerRig";
import { checkCreate, peerOwnsNetworkId, reportViolation, TakenObject } from "./spawnRules.game";

// ad-hoc messages view
const messageView = createCursorView(new ArrayBuffer(10000));

const metadataTotalBytes =
  Uint8Array.BYTES_PER_ELEMENT + Float64Array.BYTES_PER_ELEMENT + Uint32Array.BYTES_PER_ELEMENT;

export const writeMessageType = (v: CursorView, type: NetworkAction) => writeUint8(v, type);

export const writeElapsed = (v: CursorView) => writeFloat64(v, Date.now());

export const writeMetadata = (v: CursorView, type: NetworkAction) => {
  writeMessageType(v, type);
  writeElapsed(v);
  // HACK: leave space for the input tick
  scrollCursorView(v, Uint32Array.BYTES_PER_ELEMENT);
};

const _out: { type: number; elapsed: number; inputTick: number } = { type: 0, elapsed: 0, inputTick: 0 };
export const readMetadata = (v: CursorView, out = _out) => {
  out.type = readUint8(v);
  out.elapsed = readFloat64(v);
  // HACK?: read input tick processed from this peer to each packet
  out.inputTick = readUint32(v);
  return out;
};

/* Transform serialization */

export const serializeTransformSnapshot = (v: CursorView, node: RemoteNode) => {
  const position = node.position;
  writeFloat32(v, position[0]);
  writeFloat32(v, position[1]);
  writeFloat32(v, position[2]);

  const velocity = node.physicsBody!.velocity;
  writeFloat32(v, velocity[0]);
  writeFloat32(v, velocity[1]);
  writeFloat32(v, velocity[2]);

  const quaternion = node.quaternion;
  writeFloat32(v, quaternion[0]);
  writeFloat32(v, quaternion[1]);
  writeFloat32(v, quaternion[2]);
  writeFloat32(v, quaternion[3]);

  const skipLerp = node.skipLerp;
  writeUint32(v, skipLerp);

  return v;
};

export const deserializeTransformSnapshot = (
  network: GameNetworkState,
  v: CursorView,
  nid: number,
  node: RemoteNode | undefined
) => {
  if (node !== undefined) {
    const eid = node.eid;
    const position = Networked.position[eid];
    position[0] = readFloat32(v);
    position[1] = readFloat32(v);
    position[2] = readFloat32(v);

    const velocity = Networked.velocity[eid];
    velocity[0] = readFloat32(v);
    velocity[1] = readFloat32(v);
    velocity[2] = readFloat32(v);

    const quaternion = Networked.quaternion[eid];
    quaternion[0] = readFloat32(v);
    quaternion[1] = readFloat32(v);
    quaternion[2] = readFloat32(v);
    quaternion[3] = readFloat32(v);

    node.skipLerp = readUint32(v);
  } else {
    const deferredUpdates = network.deferredUpdates.get(nid);
    if (deferredUpdates !== undefined) {
      const position = new Float32Array(3);
      position[0] = readFloat32(v);
      position[1] = readFloat32(v);
      position[2] = readFloat32(v);

      const velocity = new Float32Array(3);
      velocity[0] = readFloat32(v);
      velocity[1] = readFloat32(v);
      velocity[2] = readFloat32(v);

      const quaternion = new Float32Array(4);
      quaternion[0] = readFloat32(v);
      quaternion[1] = readFloat32(v);
      quaternion[2] = readFloat32(v);
      quaternion[3] = readFloat32(v);

      deferredUpdates.push({ position, quaternion });
    } else {
      console.warn(`could not deserialize update for non-existent entity for networkID ${nid}`);
      scrollCursorView(v, Float32Array.BYTES_PER_ELEMENT * 10 + Uint32Array.BYTES_PER_ELEMENT);
    }
  }

  return v;
};

export const serializeTransformChanged = (v: CursorView, node: RemoteNode) => {
  const writeChangeMask = spaceUint16(v);
  let changeMask = 0;
  let b = 0;

  const position = node.position;
  changeMask |= writePropIfChanged(v, position, 0) ? 1 << b++ : b++ && 0;
  changeMask |= writePropIfChanged(v, position, 1) ? 1 << b++ : b++ && 0;
  changeMask |= writePropIfChanged(v, position, 2) ? 1 << b++ : b++ && 0;

  const velocity = node.physicsBody!.velocity;
  changeMask |= writePropIfChanged(v, velocity, 0) ? 1 << b++ : b++ && 0;
  changeMask |= writePropIfChanged(v, velocity, 1) ? 1 << b++ : b++ && 0;
  changeMask |= writePropIfChanged(v, velocity, 2) ? 1 << b++ : b++ && 0;

  const quaternion = node.quaternion;
  changeMask |= writePropIfChanged(v, quaternion, 0) ? 1 << b++ : b++ && 0;
  changeMask |= writePropIfChanged(v, quaternion, 1) ? 1 << b++ : b++ && 0;
  changeMask |= writePropIfChanged(v, quaternion, 2) ? 1 << b++ : b++ && 0;
  changeMask |= writePropIfChanged(v, quaternion, 3) ? 1 << b++ : b++ && 0;

  changeMask |= writeScalarPropIfChanged(v, "skipLerp", Uint32Array, node.skipLerp) ? 1 << b++ : b++ && 0;

  writeChangeMask(changeMask);

  return changeMask > 0;
};

export const deserializeTransformChanged = (v: CursorView, nid: number, node: RemoteNode | undefined) => {
  if (node) {
    const changeMask = readUint16(v);
    let b = 0;

    const position = Networked.position[node.eid];
    if (checkBitflag(changeMask, 1 << b++)) position[0] = readFloat32(v);
    if (checkBitflag(changeMask, 1 << b++)) position[1] = readFloat32(v);
    if (checkBitflag(changeMask, 1 << b++)) position[2] = readFloat32(v);

    const velocity = Networked.velocity[node.eid];
    if (checkBitflag(changeMask, 1 << b++)) velocity[0] = readFloat32(v);
    if (checkBitflag(changeMask, 1 << b++)) velocity[1] = readFloat32(v);
    if (checkBitflag(changeMask, 1 << b++)) velocity[2] = readFloat32(v);

    const quaternion = Networked.quaternion[node.eid];
    if (checkBitflag(changeMask, 1 << b++)) quaternion[0] = readFloat32(v);
    if (checkBitflag(changeMask, 1 << b++)) quaternion[1] = readFloat32(v);
    if (checkBitflag(changeMask, 1 << b++)) quaternion[2] = readFloat32(v);
    if (checkBitflag(changeMask, 1 << b++)) quaternion[3] = readFloat32(v);

    if (checkBitflag(changeMask, 1 << b++)) node.skipLerp = readUint32(v);
  } else {
    // Buzzar: skip exactly what was sent (a change mask and only the changed fields). The fixed-size skip here
    // misread every following entry.
    const changeMask = readUint16(v);
    for (let b = 0; b < 10; b++)
      if (checkBitflag(changeMask, 1 << b)) scrollCursorView(v, Float32Array.BYTES_PER_ELEMENT);
    if (checkBitflag(changeMask, 1 << 10)) scrollCursorView(v, Uint32Array.BYTES_PER_ELEMENT);
  }
};

/* Create */
export function createRemoteNetworkedEntity(
  ctx: GameContext,
  network: GameNetworkState,
  nid: number,
  prefab: string,
  createData?: ArrayBuffer
): RemoteNode {
  const node = createPrefabEntity(ctx, prefab, createData ? { createData } : {});
  if (createData) PrefabCreateData.set(node.eid, createData);

  // assign networkId
  addComponent(ctx.world, Networked, node.eid, true);
  Networked.networkId[node.eid] = nid;
  network.networkIdToEntityId.set(nid, node.eid);
  addObjectToWorld(ctx, node);

  return node;
}

function writeCreation(network: GameNetworkState, v: CursorView, eid: number) {
  const nid = Networked.networkId[eid];

  const prefabName = Prefab.get(eid);
  if (!prefabName) {
    // TODO: gracefully fail and rewind cursor view?
    throw new Error(`could not serialize creation for ${eid}, entity has no prefab`);
  }

  writeUint32(v, nid);
  writeString(v, prefabName);
  const writeDataByteLength = spaceUint32(v);

  const replicator = getReplicator(network, prefabName);
  if (!replicator) {
    // Buzzar: a stock prefab's create data (e.g. a cloned Item's size and colour).
    const data = PrefabCreateData.get(eid);
    writeDataByteLength(data?.byteLength || 0);
    if (data && data.byteLength) writeArrayBuffer(v, data);
    return;
  }

  const data = replicator.eidToData.get(eid);
  writeDataByteLength(data?.byteLength || 0);
  if (data && data.byteLength) {
    writeArrayBuffer(v, data);
  }
}

export function serializeCreatesSnapshot(ctx: GameContext, v: CursorView) {
  const network = getModule(ctx, NetworkModule);
  const entities = ownedNetworkedQuery(ctx.world);

  // TODO: optimize length written with maxEntities config
  writeUint32(v, entities.length);
  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    writeCreation(network, v, eid);
  }
}

export function serializeCreates(ctx: GameContext, v: CursorView) {
  const network = getModule(ctx, NetworkModule);
  const entities = createdOwnedNetworkedQuery(ctx.world);

  writeUint32(v, entities.length);
  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    writeCreation(network, v, eid);
  }
}

export function deserializeCreates(ctx: GameContext, v: CursorView, peerId: string) {
  const network = getModule(ctx, NetworkModule);
  const count = readUint32(v);
  for (let i = 0; i < count; i++) {
    const nid = readUint32(v);
    const prefabName = readString(v);
    const dataByteLength = readUint32(v);

    const existingEntity = network.networkIdToEntityId.get(nid);

    if (existingEntity) {
      // Buzzar: expected when a peer resends its snapshot (HavenResendSnapshot). Skip this entry's data too, or
      // every following entry is read from the wrong place.
      scrollCursorView(v, dataByteLength);
      continue;
    }

    const replicator = getReplicator(network, prefabName);

    // Buzzar: only accept objects the sender owns, of known types, within the world's rules.
    const check = checkCreate(
      ctx,
      network,
      peerId,
      nid,
      prefabName,
      !!replicator || hasPrefabTemplate(ctx, prefabName)
    );
    if (check.reject) {
      scrollCursorView(v, dataByteLength);
      reportViolation(ctx, peerId, check.reject);
      continue;
    }

    if (replicator) {
      const data = dataByteLength > 0 ? readArrayBuffer(v, dataByteLength) : undefined;

      replicator.spawned.push({
        networkId: nid,
        peerIndex: network.peerIdToIndex.get(peerId)!,
        data,
      });
      network.deferredUpdates.set(nid, []);
    } else {
      // Buzzar: a stock prefab's create data (a cloned Item's variables); the prefab validates it.
      const data = dataByteLength > 0 ? readArrayBuffer(v, dataByteLength) : undefined;
      const node = createRemoteNetworkedEntity(ctx, network, nid, prefabName, data);
      if (check.taken) addComponent(ctx.world, TakenObject, node.eid);
      // Buzzar: an older client's grab: now that its copy is here, remove the original it took over.
      if (check.replacesNid !== undefined) {
        const oldEid = network.networkIdToEntityId.get(check.replacesNid);
        const oldNode = oldEid !== undefined ? getRemoteResource<RemoteNode>(ctx, oldEid) : undefined;
        if (oldNode && oldEid !== node.eid) {
          node.position.set(oldNode.position);
          node.quaternion.set(oldNode.quaternion);
          removeObjectFromWorld(ctx, oldNode);
          network.networkIdToEntityId.delete(check.replacesNid);
        }
      }
    }
  }
}

/* Updates - Snapshot */

export function serializeUpdatesSnapshot(ctx: GameContext, v: CursorView) {
  const entities = ownedNetworkedQuery(ctx.world);
  writeUint32(v, entities.length);
  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    const nid = Networked.networkId[eid];
    const node = tryGetRemoteResource<RemoteNode>(ctx, eid);
    writeUint32(v, nid);
    serializeTransformSnapshot(v, node);
  }
}

export function deserializeUpdatesSnapshot(ctx: GameContext, v: CursorView, peerId?: string) {
  const network = getModule(ctx, NetworkModule);
  const count = readUint32(v);
  for (let i = 0; i < count; i++) {
    const nid = readUint32(v);
    // Buzzar: a peer may only move its own objects.
    const owned = peerOwnsNetworkId(network, peerId, nid);
    if (!owned && peerId) reportViolation(ctx, peerId, "tried to move someone else's object");
    const eid = (owned && network.networkIdToEntityId.get(nid)) || NOOP;
    const node = getRemoteResource<RemoteNode>(ctx, eid);

    deserializeTransformSnapshot(network, v, nid, node);
  }
}

/* Updates - Changed */

export function serializeUpdatesChanged(ctx: GameContext, v: CursorView) {
  const entities = ownedNetworkedQuery(ctx.world);
  const writeCount = spaceUint32(v);
  let count = 0;
  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    const nid = Networked.networkId[eid];
    const node = tryGetRemoteResource<RemoteNode>(ctx, eid);
    const rewind = rewindCursorView(v);
    const writeNid = spaceUint32(v);
    const written = serializeTransformChanged(v, node);
    if (written) {
      writeNid(nid);
      count += 1;
    } else {
      rewind();
    }
  }
  writeCount(count);
}

export function deserializeUpdatesChanged(ctx: GameContext, v: CursorView, peerId?: string) {
  const network = getModule(ctx, NetworkModule);
  const count = readUint32(v);
  for (let i = 0; i < count; i++) {
    const nid = readUint32(v);
    // Buzzar: a peer may only move its own objects.
    const owned = peerOwnsNetworkId(network, peerId, nid);
    if (!owned && peerId) reportViolation(ctx, peerId, "tried to move someone else's object");
    const eid = (owned && network.networkIdToEntityId.get(nid)) || NOOP;

    if (eid === NOOP && owned && peerId) {
      // Buzzar: we missed this peer's creates; the outbound system asks it to resend (HavenResendSnapshot).
      network.unknownEntityPeers.add(peerId);
    }

    const node = getRemoteResource<RemoteNode>(ctx, eid);
    deserializeTransformChanged(v, nid, node);
  }
}

/* Delete */

export function serializeDeletes(ctx: GameContext, v: CursorView) {
  // Buzzar: objects handed over to someone else left our owned query but weren't deleted.
  const entities = deletedOwnedNetworkedQuery(ctx.world).filter(
    (eid) => !(entityExists(ctx.world, eid) && hasComponent(ctx.world, Networked, eid))
  );
  writeUint32(v, entities.length);
  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    const nid = Networked.networkId[eid];
    writeUint32(v, nid);
    console.info("serialized deletion for nid", nid, "eid", eid, "prefab", Prefab.get(eid));
  }
}

export function deserializeDeletes(ctx: GameContext, v: CursorView, peerId?: string) {
  const network = getModule(ctx, NetworkModule);
  const count = readUint32(v);
  for (let i = 0; i < count; i++) {
    const nid = readUint32(v);
    // Buzzar: a peer may only delete its own objects.
    if (!peerOwnsNetworkId(network, peerId, nid)) {
      if (peerId) reportViolation(ctx, peerId, "tried to delete someone else's object");
      continue;
    }
    const eid = network.networkIdToEntityId.get(nid);
    const node = eid ? getRemoteResource<RemoteNode>(ctx, eid) : undefined;
    if (!node) {
      console.warn(`could not remove networkId ${nid}, no matching entity`);
    } else {
      console.info("deserialized deletion for nid", nid, "eid", eid);
      removeObjectFromWorld(ctx, node);
      network.networkIdToEntityId.delete(nid);
    }
  }
}

/* Update NetworkId Message */

export const serializeUpdateNetworkId = (ctx: GameContext, v: CursorView, from: number, to: number) => {
  console.info("serializeUpdateNetworkId", from, "->", to);
  writeUint32(v, from);
  writeUint32(v, to);
};
export function deserializeUpdateNetworkId(ctx: GameContext, v: CursorView, peerId?: string) {
  const network = getModule(ctx, NetworkModule);

  const from = readUint32(v);
  const to = readUint32(v);

  // Buzzar: only renumber your own objects, to your own IDs.
  if (!peerOwnsNetworkId(network, peerId, from) || !peerOwnsNetworkId(network, peerId, to)) {
    if (peerId) reportViolation(ctx, peerId, "tried to take over someone else's object ID");
    return;
  }

  const eid = network.networkIdToEntityId.get(from);
  if (!eid) {
    console.warn("could not find entity for nid: " + from);
    return;
  }

  Networked.networkId[eid] = to;

  console.info("deserializeUpdateNetworkId", from, "->", to);
}
export function createUpdateNetworkIdMessage(ctx: GameContext, from: number, to: number) {
  writeMetadata(messageView, NetworkAction.UpdateNetworkId);
  serializeUpdateNetworkId(ctx, messageView, from, to);
  return sliceCursorView(messageView);
}

/* Player NetworkId Message */

export const serializeInformPlayerNetworkId = (ctx: GameContext, v: CursorView, peerId: string) => {
  console.info("serializeInformPlayerNetworkId", peerId);
  const network = getModule(ctx, NetworkModule);
  const peerEid = network.peerIdToEntityId.get(peerId);
  if (peerEid === undefined) {
    throw new Error(`could not send NetworkMessage.InformPlayerNetworkId, ${peerId} not set on peerIdToEntity map`);
  }

  const peerNid = Networked.networkId[peerEid];
  if (peerNid === NOOP) {
    throw new Error(`could not send NetworkMessage.InformPlayerNetworkId, ${peerEid} has no networkId assigned`);
  }

  writeString(v, peerId);
  writeUint32(v, peerNid);
};

export async function deserializeInformPlayerNetworkId(ctx: GameContext, v: CursorView, senderPeerId?: string) {
  const network = getModule(ctx, NetworkModule);

  // read
  const peerId = readString(v);
  const peerNid = readUint32(v);

  // Buzzar: a peer can only say which entity is *its own* player, never someone else's.
  if (senderPeerId && (peerId !== senderPeerId || !peerOwnsNetworkId(network, senderPeerId, peerNid))) {
    reportViolation(ctx, senderPeerId, "claimed to be someone else");
    return;
  }

  console.info("deserializeInformPlayerNetworkId for peer", peerId, peerNid);

  // BUG: entity creation message is parsed after this message for some reason
  // HACK: await the entity's creation
  const peid = await waitUntil<number>(() => network.networkIdToEntityId.get(peerNid));

  // Buzzar: a resent snapshot (HavenResendSnapshot) informs us again; the player is already set up.
  if (network.peerIdToEntityId.get(peerId) === peid) return;
  associatePeerWithEntity(network, peerId, peid);
  addPlayerFromPeer(ctx, peid, peerId);
  // Buzzar: addPlayerFromPeer already adds the Player component, audio emitter and nametag. A leftover copy of
  // that code here (from an upstream merge) gave every remote player a second name tag.
}

export function createInformXRModeMessage(ctx: GameContext, xrMode: XRMode) {
  writeMetadata(messageView, NetworkAction.InformXRMode);

  serializeInformXRMode(messageView, xrMode);

  return sliceCursorView(messageView);
}
export const serializeInformXRMode = (v: CursorView, xrMode: XRMode) => {
  writeUint8(v, xrMode);
};
export const deserializeInformXRMode = (ctx: GameContext, v: CursorView, peerId: string) => {
  const network = getModule(ctx, NetworkModule);

  // read
  const xrMode = readUint8(v);

  console.info(`deserializeInformXRMode - peerId: ${peerId}; xrMode: ${xrMode}`);

  // effect
  network.peerIdToXRMode.set(peerId, xrMode);
};

export function createInformPlayerNetworkIdMessage(ctx: GameContext, peerId: string) {
  writeMetadata(messageView, NetworkAction.InformPlayerNetworkId);
  serializeInformPlayerNetworkId(ctx, messageView, peerId);
  return sliceCursorView(messageView);
}

/* Message Factories */

// New Peer Snapshot Update

export const createNewPeerSnapshotMessage = (ctx: GameContext, v: CursorView) => {
  writeMetadata(v, NetworkAction.NewPeerSnapshot);
  serializeCreatesSnapshot(ctx, v);
  serializeUpdatesSnapshot(ctx, v);
  return sliceCursorView(v);
};

export const deserializeNewPeerSnapshot = (ctx: GameContext, v: CursorView, peerId: string) => {
  deserializeCreates(ctx, v, peerId);
  // The sender is needed: without it the ownership check rejects every position, and someone who hadn't moved
  // since we arrived stood at the world origin for us.
  deserializeUpdatesSnapshot(ctx, v, peerId);
};

// Full Snapshot Update
export const createFullSnapshotMessage = (ctx: GameContext, v: CursorView) => {
  writeMetadata(v, NetworkAction.FullSnapshot);
  serializeCreates(ctx, v);
  serializeUpdatesSnapshot(ctx, v);
  serializeDeletes(ctx, v);
  if (v.cursor <= metadataTotalBytes + Uint32Array.BYTES_PER_ELEMENT * 3) {
    moveCursorView(v, 0);
  }
  return sliceCursorView(v);
};

export const deserializeSnapshot = (ctx: GameContext, v: CursorView, peerId: string) => {
  deserializeCreates(ctx, v, peerId);
  // The sender is needed: without it the ownership check rejects every position, and someone who hadn't moved
  // since we arrived stood at the world origin for us.
  deserializeUpdatesSnapshot(ctx, v, peerId);
};

// Changed State Update
export const createFullChangedMessage = (ctx: GameContext, v: CursorView) => {
  writeMetadata(v, NetworkAction.FullChanged);
  serializeCreates(ctx, v);
  serializeUpdatesChanged(ctx, v);
  serializeDeletes(ctx, v);
  if (v.cursor <= metadataTotalBytes + Uint32Array.BYTES_PER_ELEMENT * 3) {
    moveCursorView(v, 0);
  }
  return sliceCursorView(v);
};

export const deserializeFullChangedUpdate = (ctx: GameContext, v: CursorView, peerId: string) => {
  deserializeCreates(ctx, v, peerId);
  deserializeUpdatesChanged(ctx, v);
  deserializeDeletes(ctx, v);
};

// Deletion Update
export const createDeleteMessage = (ctx: GameContext, v: CursorView) => {
  writeMetadata(v, NetworkAction.Delete);
  serializeDeletes(ctx, v);
  if (v.cursor <= metadataTotalBytes + Uint32Array.BYTES_PER_ELEMENT) {
    moveCursorView(v, 0);
  }
  return sliceCursorView(v);
};

export const createCreateMessage = (ctx: GameContext, v: CursorView) => {
  writeMetadata(v, NetworkAction.Create);
  serializeCreates(ctx, v);
  if (v.cursor <= metadataTotalBytes + Uint32Array.BYTES_PER_ELEMENT) {
    moveCursorView(v, 0);
  }
  return sliceCursorView(v);
};

export const createUpdateChangedMessage = (ctx: GameContext, v: CursorView) => {
  writeMetadata(v, NetworkAction.UpdateChanged);
  serializeUpdatesChanged(ctx, v);
  if (v.cursor <= metadataTotalBytes + Uint32Array.BYTES_PER_ELEMENT) {
    moveCursorView(v, 0);
  }
  return sliceCursorView(v);
};

export const createUpdateSnapshotMessage = (ctx: GameContext, v: CursorView) => {
  writeMetadata(v, NetworkAction.UpdateSnapshot);
  serializeUpdatesSnapshot(ctx, v);
  if (v.cursor <= metadataTotalBytes + Uint32Array.BYTES_PER_ELEMENT) {
    moveCursorView(v, 0);
  }
  return sliceCursorView(v);
};
