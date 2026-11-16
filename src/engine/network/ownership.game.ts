/**
 * Taking (grabbing) networked objects.
 *
 * Buzzar: ownership moves *in place* (NetworkAction.HavenTakeOwnership: old network ID → new ID under the taker's
 * peer index). Everyone keeps the same object where it is and just relabels who controls it: no blink, no pop at
 * the origin, and taking can never delete anything.
 *
 * Third Room deleted the object (RemoveOwnershipMessage) and the taker created a fresh copy. That's still sent too,
 * for older clients, but a bare RemoveOwnership no longer deletes anything here: it only takes effect when the same
 * peer's replacement copy follows within a few seconds (what an older client's grab does). Otherwise anyone could
 * delete everyone's objects with one message.
 */
import { addComponent, entityExists, hasComponent, removeComponent } from "bitecs";

import { sliceCursorView, CursorView, writeUint32, readUint32, createCursorView } from "../allocator/CursorView";
import { NOOP } from "../config.common";
import { GameContext } from "../GameTypes";
import { getModule } from "../module/module.common";
import { Prefab } from "../prefab/prefab.game";
import { getRemoteResource } from "../resource/resource.game";
import { RemoteNode } from "../resource/RemoteResources";
import {
  createNetworkId,
  GameNetworkState,
  getPeerIndexFromNetworkId,
  NetworkModule,
  ownedPlayerQuery,
  removeNetworkId,
} from "./network.game";
import { Networked, Owned } from "./NetworkComponents";
import { NetworkAction } from "./NetworkAction";
import { broadcastReliable } from "./outbound.game";
import { writeMetadata } from "./serialization.game";
import { addEntityToHistorian, removeEntityFromHistorian } from "./Historian";
import { takeSceneGrabbable } from "../../plugins/scene-grabbables/grabbables.game";
import { GrabComponent } from "../../plugins/interaction/interaction.game";
import { canTakeObject, grantTakeCredit, peerOwnsNetworkId, reportViolation, TakenObject } from "./spawnRules.game";

const messageView = createCursorView(new ArrayBuffer(Uint32Array.BYTES_PER_ELEMENT * 30));

/** Legacy (Third Room) "I took this; delete your copy". */
export const createRemoveOwnershipMessage = (ctx: GameContext, nid: number) => {
  writeMetadata(messageView, NetworkAction.RemoveOwnershipMessage);
  writeUint32(messageView, nid);
  return sliceCursorView(messageView);
};

/** Buzzar: "object oldNid is mine now, as newNid". */
export const createTakeOwnershipMessage = (oldNid: number, newNid: number) => {
  writeMetadata(messageView, NetworkAction.HavenTakeOwnership);
  writeUint32(messageView, oldNid);
  writeUint32(messageView, newNid);
  return sliceCursorView(messageView);
};

/** Relabels an entity's network ID, keeping the entity (and moving it to the new owner's interpolation history). */
function remapNetworkId(network: GameNetworkState, eid: number, oldNid: number, newNid: number) {
  network.networkIdToEntityId.delete(oldNid);
  network.networkIdToEntityId.set(newNid, eid);
  Networked.networkId[eid] = newNid;

  const oldPeer = network.indexToPeerId.get(getPeerIndexFromNetworkId(oldNid));
  const newPeer = network.indexToPeerId.get(getPeerIndexFromNetworkId(newNid));
  const oldHistorian = oldPeer ? network.peerIdToHistorian.get(oldPeer) : undefined;
  const newHistorian = newPeer ? network.peerIdToHistorian.get(newPeer) : undefined;
  if (oldHistorian) removeEntityFromHistorian(oldHistorian, eid);
  if (newHistorian && !newHistorian.entities.has(eid)) addEntityToHistorian(newHistorian, eid);
}

export const deserializeTakeOwnership = (ctx: GameContext, cv: CursorView, peerId?: string) => {
  const network = getModule(ctx, NetworkModule);
  const oldNid = readUint32(cv);
  const newNid = readUint32(cv);
  if (!peerId) return;

  if (!peerOwnsNetworkId(network, peerId, newNid)) {
    reportViolation(ctx, peerId, "tried to take an object under someone else's ID");
    return;
  }
  if (network.networkIdToEntityId.has(newNid)) return; // already applied (or a clash): leave it
  const eid = network.networkIdToEntityId.get(oldNid);
  if (eid === undefined) return; // an object we don't have (e.g. missed its create)
  if (!canTakeObject(ctx, eid)) {
    reportViolation(ctx, peerId, "tried to take another player");
    return;
  }

  if (hasComponent(ctx.world, Owned, eid)) {
    // It was ours. Let go of it if we were holding it, and start following the new owner from where it is now.
    const rig = ownedPlayerQuery(ctx.world)[0];
    if (rig !== undefined && hasComponent(ctx.world, GrabComponent, rig) && GrabComponent.grabbedEntity[rig] === eid) {
      removeComponent(ctx.world, GrabComponent, rig, true);
    }
    const node = getRemoteResource<RemoteNode>(ctx, eid);
    if (node) {
      Networked.position[eid].set(node.position);
      Networked.quaternion[eid].set(node.quaternion);
      Networked.velocity[eid].fill(0);
    }
    removeNetworkId(ctx, oldNid); // our ID is free again
    remapNetworkId(network, eid, oldNid, newNid);
    removeComponent(ctx.world, Owned, eid);
  } else {
    remapNetworkId(network, eid, oldNid, newNid);
  }
  // Moved, not spawned: doesn't count toward the new owner's per-person limit.
  addComponent(ctx.world, TakenObject, eid);
};

/** Legacy RemoveOwnership: only honoured once the same peer's replacement copy arrives (see spawnRules). */
export const deserializeRemoveOwnership = (ctx: GameContext, cv: CursorView, peerId?: string) => {
  const network = getModule(ctx, NetworkModule);
  const nid = readUint32(cv);
  const eid = network.networkIdToEntityId.get(nid);
  if (eid === undefined || !peerId) return;
  if (!canTakeObject(ctx, eid)) {
    reportViolation(ctx, peerId, "tried to remove another player");
    return;
  }
  const prefab = Prefab.get(eid);
  if (prefab) grantTakeCredit(ctx, peerId, prefab, nid);
};

/** Takes an object someone else owns (when grabbing it). Returns the entity now held, or NOOP. */
export const takeOwnership = (ctx: GameContext, network: GameNetworkState, node: RemoteNode): number => {
  // Buzzar: objects placed in the world (HAVEN_grabbable) become networked copies when first grabbed.
  const sceneCopy = takeSceneGrabbable(ctx, node);
  if (sceneCopy !== undefined) return sceneCopy;

  const eid = node.eid;
  if (
    !hasComponent(ctx.world, Prefab, eid) ||
    !hasComponent(ctx.world, Networked, eid) ||
    hasComponent(ctx.world, Owned, eid) ||
    !canTakeObject(ctx, eid)
  ) {
    return NOOP;
  }

  const oldNid = Networked.networkId[eid];
  const newNid = createNetworkId(ctx);
  if (!newNid) return NOOP;

  remapNetworkId(network, eid, oldNid, newNid);
  addComponent(ctx.world, Owned, eid);
  // Taken, not spawned, so it doesn't count toward our own per-person limit either.
  addComponent(ctx.world, TakenObject, eid);

  broadcastReliable(ctx, network, createTakeOwnershipMessage(oldNid, newNid));
  // Older clients: delete your copy (our Create for newNid follows, as before). Newer ones ignore this, since
  // they've already relabelled oldNid.
  broadcastReliable(ctx, network, createRemoveOwnershipMessage(ctx, oldNid));

  return eid;
};

/** Whether an owned entity that left the owned query was only handed over (still networked), not deleted. */
export const wasHandedOver = (ctx: GameContext, eid: number) =>
  entityExists(ctx.world, eid) && hasComponent(ctx.world, Networked, eid);
