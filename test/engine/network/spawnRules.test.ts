import { strictEqual } from "assert";
import { addComponent } from "bitecs";
import { describe, it } from "vitest";

import {
  createCursorView,
  writeFloat32,
  writeString,
  writeUint16,
  writeUint32,
} from "../../../src/engine/allocator/CursorView";
import { getModule } from "../../../src/engine/module/module.common";
import { NetworkModule } from "../../../src/engine/network/network.game";
import { Networked } from "../../../src/engine/network/NetworkComponents";
import { deserializeCreates, deserializeUpdatesChanged } from "../../../src/engine/network/serialization.game";
import { deserializeRemoveOwnership, deserializeTakeOwnership } from "../../../src/engine/network/ownership.game";
import { SpawnRulesModule } from "../../../src/engine/network/spawnRules.game";
import { PrefabType, registerPrefab } from "../../../src/engine/prefab/prefab.game";
import { RemoteNode } from "../../../src/engine/resource/RemoteResources";
import { mockGameState } from "../mocks";

const ALICE = "@alice:example.org";
const MALLORY = "@mallory:example.org";
const nid = (index: number, local: number) => ((local << 16) | index) >>> 0;

function setup() {
  const ctx = mockGameState();
  (ctx as unknown as { sendMessage: () => void }).sendMessage = () => undefined;
  registerPrefab(ctx, { name: "small-crate", type: PrefabType.Object, create: () => new RemoteNode(ctx.resourceManager) });
  registerPrefab(ctx, { name: "small-ball", type: PrefabType.Object, create: () => new RemoteNode(ctx.resourceManager) });
  const network = getModule(ctx, NetworkModule);
  network.peerIdToIndex.set(ALICE, 1);
  network.peerIdToIndex.set(MALLORY, 2);
  return { ctx, network };
}

/** A Create message: entries of [networkId, prefab]. */
function creates(entries: [number, string][]) {
  const v = createCursorView();
  writeUint32(v, entries.length);
  for (const [id, prefab] of entries) {
    writeUint32(v, id);
    writeString(v, prefab);
    writeUint32(v, 0);
  }
  return createCursorView(v.buffer);
}

describe("Buzzar spawn rules and ownership", () => {
  it("accepts a peer's own objects", () => {
    const { ctx, network } = setup();
    deserializeCreates(ctx, creates([[nid(2, 1), "small-crate"]]), MALLORY);
    strictEqual(network.networkIdToEntityId.has(nid(2, 1)), true);
  });

  it("rejects objects created under someone else's peer index, and keeps reading after it", () => {
    const { ctx, network } = setup();
    deserializeCreates(
      ctx,
      creates([
        [nid(1, 5), "small-crate"],
        [nid(2, 6), "small-crate"],
      ]),
      MALLORY
    );
    strictEqual(network.networkIdToEntityId.has(nid(1, 5)), false);
    strictEqual(network.networkIdToEntityId.has(nid(2, 6)), true);
  });

  it("rejects unknown prefab names instead of throwing", () => {
    const { ctx, network } = setup();
    deserializeCreates(ctx, creates([[nid(2, 1), "giant-spam-cube"]]), MALLORY);
    strictEqual(network.networkIdToEntityId.has(nid(2, 1)), false);
  });

  it("rejects stock objects the world doesn't allow", () => {
    const { ctx, network } = setup();
    getModule(ctx, SpawnRulesModule).rules = { allowed: ["small-crate"] };
    deserializeCreates(
      ctx,
      creates([
        [nid(2, 1), "small-ball"],
        [nid(2, 2), "small-crate"],
      ]),
      MALLORY
    );
    strictEqual(network.networkIdToEntityId.has(nid(2, 1)), false);
    strictEqual(network.networkIdToEntityId.has(nid(2, 2)), true);
  });

  it("enforces the per-person limit", () => {
    const { ctx, network } = setup();
    getModule(ctx, SpawnRulesModule).rules = { maxPerUser: 2 };
    deserializeCreates(
      ctx,
      creates([
        [nid(2, 1), "small-crate"],
        [nid(2, 2), "small-crate"],
        [nid(2, 3), "small-crate"],
      ]),
      MALLORY
    );
    strictEqual(network.networkIdToEntityId.has(nid(2, 2)), true);
    strictEqual(network.networkIdToEntityId.has(nid(2, 3)), false);
    // Someone else's objects don't count against Mallory.
    deserializeCreates(ctx, creates([[nid(1, 1), "small-crate"]]), ALICE);
    strictEqual(network.networkIdToEntityId.has(nid(1, 1)), true);
  });

  it("ignores moves of someone else's object, and still reads the rest of the message", () => {
    const { ctx, network } = setup();
    deserializeCreates(ctx, creates([[nid(1, 1), "small-crate"]]), ALICE);
    deserializeCreates(ctx, creates([[nid(2, 1), "small-crate"]]), MALLORY);
    const aliceEid = network.networkIdToEntityId.get(nid(1, 1))!;
    const malloryEid = network.networkIdToEntityId.get(nid(2, 1))!;
    addComponent(ctx.world, Networked, aliceEid);
    addComponent(ctx.world, Networked, malloryEid);

    // Mallory sends a change for Alice's crate (x only), then a full change for her own.
    const v = createCursorView();
    writeUint32(v, 2);
    writeUint32(v, nid(1, 1));
    writeUint16(v, 0b1);
    writeFloat32(v, 99);
    writeUint32(v, nid(2, 1));
    writeUint16(v, 0b1);
    writeFloat32(v, 42);
    deserializeUpdatesChanged(ctx, createCursorView(v.buffer), MALLORY);

    strictEqual(Networked.position[aliceEid][0], 0);
    strictEqual(Networked.position[malloryEid][0], 42);
  });

  it("lets a player at the limit take (grab) someone else's object without it being refused", () => {
    const { ctx, network } = setup();
    getModule(ctx, SpawnRulesModule).rules = { maxPerUser: 1 };
    deserializeCreates(ctx, creates([[nid(1, 1), "small-crate"]]), ALICE);
    deserializeCreates(ctx, creates([[nid(2, 1), "small-crate"]]), MALLORY); // Mallory is at her limit

    // Mallory grabs Alice's crate: "remove ownership" of Alice's copy, then a create of her own copy.
    const take = createCursorView();
    writeUint32(take, nid(1, 1));
    deserializeRemoveOwnership(ctx, createCursorView(take.buffer), MALLORY);
    deserializeCreates(ctx, creates([[nid(2, 2), "small-crate"]]), MALLORY);
    strictEqual(network.networkIdToEntityId.has(nid(2, 2)), true);

    // Her copy replaced Alice's original.
    strictEqual(network.networkIdToEntityId.has(nid(1, 1)), false);

    // The credit is used up: a further spawn of her own is still over the limit.
    deserializeCreates(ctx, creates([[nid(2, 3), "small-crate"]]), MALLORY);
    strictEqual(network.networkIdToEntityId.has(nid(2, 3)), false);
  });

  it("ignores a bare 'remove ownership' (it can't delete objects without the taker's copy)", () => {
    const { ctx, network } = setup();
    deserializeCreates(ctx, creates([[nid(1, 1), "small-crate"]]), ALICE);
    const msg = createCursorView();
    writeUint32(msg, nid(1, 1));
    deserializeRemoveOwnership(ctx, createCursorView(msg.buffer), MALLORY);
    strictEqual(network.networkIdToEntityId.has(nid(1, 1)), true);
  });

  it("hands an object over in place: same entity, new owner, not counted against the taker", () => {
    const { ctx, network } = setup();
    getModule(ctx, SpawnRulesModule).rules = { maxPerUser: 1 };
    deserializeCreates(ctx, creates([[nid(1, 1), "small-crate"]]), ALICE);
    deserializeCreates(ctx, creates([[nid(2, 1), "small-crate"]]), MALLORY);
    const eid = network.networkIdToEntityId.get(nid(1, 1))!;

    const take = createCursorView();
    writeUint32(take, nid(1, 1));
    writeUint32(take, nid(2, 2));
    deserializeTakeOwnership(ctx, createCursorView(take.buffer), MALLORY);

    strictEqual(network.networkIdToEntityId.has(nid(1, 1)), false);
    strictEqual(network.networkIdToEntityId.get(nid(2, 2)), eid);
    strictEqual(Networked.networkId[eid], nid(2, 2));
    // Mallory's later Create for the same ID (sent for older clients) doesn't make a second copy.
    deserializeCreates(ctx, creates([[nid(2, 2), "small-crate"]]), MALLORY);
    strictEqual(network.networkIdToEntityId.get(nid(2, 2)), eid);
  });

  it("refuses a take under someone else's ID", () => {
    const { ctx, network } = setup();
    deserializeCreates(ctx, creates([[nid(1, 1), "small-crate"]]), ALICE);
    const take = createCursorView();
    writeUint32(take, nid(1, 1));
    writeUint32(take, nid(1, 9)); // Alice's index, sent by Mallory
    deserializeTakeOwnership(ctx, createCursorView(take.buffer), MALLORY);
    strictEqual(network.networkIdToEntityId.has(nid(1, 1)), true);
    strictEqual(network.networkIdToEntityId.has(nid(1, 9)), false);
  });
});
