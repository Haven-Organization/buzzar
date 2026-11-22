// import { describe, it } from "vitest";
import { ok, strictEqual } from "assert";
import { addComponent, entityExists, getEntityComponents, removeComponent } from "bitecs";

import { GameContext } from "../../../src/engine/GameTypes";
import {
  createNetworkId,
  getPeerIndexFromNetworkId,
  getLocalIdFromNetworkId,
  remoteNetworkedQuery,
  ownedNetworkedQuery,
  NetworkModule,
} from "../../../src/engine/network/network.game";
import { Owned, Networked } from "../../../src/engine/network/NetworkComponents";
import {
  createCursorView,
  readFloat32,
  readString,
  readUint16,
  readUint32,
  skipUint32,
  writeUint32,
} from "../../../src/engine/allocator/CursorView";
import { mockGameState } from "../mocks";
import { getModule } from "../../../src/engine/module/module.common";
import {
  addPrefabComponent,
  PrefabCreateData,
  PrefabType,
  registerPrefab,
} from "../../../src/engine/prefab/prefab.game";
import {
  serializeTransformSnapshot,
  deserializeTransformSnapshot,
  serializeTransformChanged,
  deserializeTransformChanged,
  serializeUpdatesSnapshot,
  deserializeUpdatesSnapshot,
  serializeUpdatesChanged,
  deserializeUpdatesChanged,
  serializeCreates,
  deserializeCreates,
  serializeDeletes,
  deserializeDeletes,
  deserializeNewPeerSnapshot,
} from "../../../src/engine/network/serialization.game";
import { toBinaryString } from "../../../src/engine/utils/toBinaryString";
import { RemotePhysicsBody, RemoteNode } from "../../../src/engine/resource/RemoteResources";
import { PhysicsModule, addPhysicsBody } from "../../../src/engine/physics/physics.game";
import { PhysicsBodyType } from "../../../src/engine/resource/schema";

const clearComponentData = () => {
  new Uint8Array(Networked.velocity[0].buffer).fill(0);
  new Uint8Array(Networked.position[0].buffer).fill(0);
  new Uint8Array(Networked.velocity[0].buffer).fill(0);
  new Uint8Array(Networked.quaternion[0].buffer).fill(0);
};

// Buzzar: incoming messages are only accepted for objects whose network ID carries the sender's peer index.
const SENDER = "@sender:example.org";
const SENDER_INDEX = 7;
const senderNid = (localId: number) => ((localId << 16) | SENDER_INDEX) >>> 0;

describe("Network Tests", () => {
  describe("networkId", () => {
    it("should #getPeerIdFromNetworkId()", () => {
      const nid = 0xfff0_000f;
      strictEqual(getPeerIndexFromNetworkId(nid), 0x000f);
    });
    it("should #getLocalIdFromNetworkId()", () => {
      const nid = 0xfff0_000f;
      strictEqual(getLocalIdFromNetworkId(nid), 0xfff0);
    });
    // hack - remove for id layer
    it.skip("should #createNetworkId", () => {
      const state = {
        network: {
          peerId: "abc",
          peerIdToIndex: new Map([["abc", 0x00ff]]),
          localIdCount: 0x000f,
          removedLocalIds: [],
        },
      } as unknown as GameContext;
      const nid = createNetworkId(state);
      strictEqual(nid, 0x000f_00ff);
    });
  });
  describe("transform serialization", () => {
    beforeEach(clearComponentData);
    it("should #serializeTransformSnapshot()", () => {
      const writer = createCursorView();
      const state = mockGameState();
      const node = new RemoteNode(state.resourceManager);
      const physics = getModule(state, PhysicsModule);

      addPhysicsBody(
        state.world,
        physics,
        node,
        new RemotePhysicsBody(state.resourceManager, {
          type: PhysicsBodyType.Rigid,
        })
      );

      node.position.set([1, 2, 3]);
      node.quaternion.set([4, 5, 6, 1]);

      const velocity = node.physicsBody!.velocity;
      velocity.set([4, 5, 6]);

      serializeTransformSnapshot(writer, node);

      const reader = createCursorView(writer.buffer);

      const posX = readFloat32(reader);
      strictEqual(posX, 1);

      const posY = readFloat32(reader);
      strictEqual(posY, 2);

      const posZ = readFloat32(reader);
      strictEqual(posZ, 3);

      const velX = readFloat32(reader);
      strictEqual(velX, 4);

      const velY = readFloat32(reader);
      strictEqual(velY, 5);

      const velZ = readFloat32(reader);
      strictEqual(velZ, 6);

      const rotX = readFloat32(reader);
      strictEqual(rotX, 4);

      const rotY = readFloat32(reader);
      strictEqual(rotY, 5);

      const rotZ = readFloat32(reader);
      strictEqual(rotZ, 6);
    });
    it("should #deserializeTransformSnapshot()", () => {
      const writer = createCursorView();
      const state = mockGameState();
      const network = getModule(state, NetworkModule);

      const node = new RemoteNode(state.resourceManager);
      const eid = node.eid;

      const physics = getModule(state, PhysicsModule);

      addPhysicsBody(
        state.world,
        physics,
        node,
        new RemotePhysicsBody(state.resourceManager, {
          type: PhysicsBodyType.Rigid,
        })
      );

      node.position.set([1, 2, 3]);
      node.quaternion.set([7, 8, 9, 10]);

      const position = node.position;
      const velocity = node.physicsBody!.velocity;
      const quaternion = node.quaternion;
      velocity.set([4, 5, 6]);

      serializeTransformSnapshot(writer, node);

      position.set([0, 0, 0]);
      velocity.set([0, 0, 0]);
      quaternion.set([0, 0, 0, 0]);

      const reader = createCursorView(writer.buffer);

      deserializeTransformSnapshot(network, reader, 0, node);

      strictEqual(Networked.position[eid][0], 1);
      strictEqual(Networked.position[eid][1], 2);
      strictEqual(Networked.position[eid][2], 3);

      strictEqual(Networked.velocity[eid][0], 4);
      strictEqual(Networked.velocity[eid][1], 5);
      strictEqual(Networked.velocity[eid][2], 6);

      strictEqual(Networked.quaternion[eid][0], 7);
      strictEqual(Networked.quaternion[eid][1], 8);
      strictEqual(Networked.quaternion[eid][2], 9);
      strictEqual(Networked.quaternion[eid][3], 10);
    });
    it("should #serializeTransformChanged() with all values", () => {
      const writer = createCursorView();
      const state = mockGameState();
      const node = new RemoteNode(state.resourceManager);

      const physics = getModule(state, PhysicsModule);

      addPhysicsBody(
        state.world,
        physics,
        node,
        new RemotePhysicsBody(state.resourceManager, {
          type: PhysicsBodyType.Rigid,
        })
      );

      node.position.set([1, 2, 3]);
      node.quaternion.set([4, 5, 6, 7]);

      serializeTransformChanged(writer, node);

      const reader = createCursorView(writer.buffer);

      const changeMask = readUint16(reader);
      strictEqual(changeMask, 0b11111000111, `Expected ${toBinaryString(changeMask)} to equal 0b111000111`);

      const posX = readFloat32(reader);
      strictEqual(posX, 1);

      const posY = readFloat32(reader);
      strictEqual(posY, 2);

      const posZ = readFloat32(reader);
      strictEqual(posZ, 3);

      const rotX = readFloat32(reader);
      strictEqual(rotX, 4);

      const rotY = readFloat32(reader);
      strictEqual(rotY, 5);

      const rotZ = readFloat32(reader);
      strictEqual(rotZ, 6);

      const rotW = readFloat32(reader);
      strictEqual(rotW, 7);
    });
    it("should #serializeTransformChanged() with some values", () => {
      const writer = createCursorView();
      const state = mockGameState();

      const node = new RemoteNode(state.resourceManager);

      const physics = getModule(state, PhysicsModule);

      addPhysicsBody(
        state.world,
        physics,
        node,
        new RemotePhysicsBody(state.resourceManager, {
          type: PhysicsBodyType.Rigid,
        })
      );

      node.position.set([0, 2, 0]);
      node.quaternion.set([4, 0, 6, 0]);

      serializeTransformChanged(writer, node);

      const reader = createCursorView(writer.buffer);

      const changeMask = readUint16(reader);
      strictEqual(changeMask, 0b10101000010, `Expected ${toBinaryString(changeMask)} to equal 0b101000010`);

      // const posX = readFloat32(reader);
      // strictEqual(posX, 0);

      const posY = readFloat32(reader);
      strictEqual(posY, 2);

      // const posZ = readFloat32(reader);
      // strictEqual(posZ, 0);

      const quatX = readFloat32(reader);
      strictEqual(quatX, 4);

      // const rotY = readFloat32(reader);
      // strictEqual(rotY, 0);

      const quatZ = readFloat32(reader);
      strictEqual(quatZ, 6);

      // const quatW = readFloat32(reader);
      // strictEqual(quatW, 0);
    });
    it("should #deserializeTransformChanged() with all values", () => {
      const writer = createCursorView();
      const state = mockGameState();

      const node = new RemoteNode(state.resourceManager);
      const eid = node.eid;

      const physics = getModule(state, PhysicsModule);

      addPhysicsBody(
        state.world,
        physics,
        node,
        new RemotePhysicsBody(state.resourceManager, {
          type: PhysicsBodyType.Rigid,
        })
      );

      node.position.set([1, 2, 3]);
      node.quaternion.set([4, 5, 6, 7]);

      serializeTransformChanged(writer, node);

      node.position.set([0, 0, 0]);
      node.quaternion.set([0, 0, 0, 0]);

      const reader = createCursorView(writer.buffer);

      deserializeTransformChanged(reader, eid, node);

      strictEqual(Networked.position[eid][0], 1);
      strictEqual(Networked.position[eid][1], 2);
      strictEqual(Networked.position[eid][2], 3);

      strictEqual(Networked.quaternion[eid][0], 4);
      strictEqual(Networked.quaternion[eid][1], 5);
      strictEqual(Networked.quaternion[eid][2], 6);
      strictEqual(Networked.quaternion[eid][3], 7);
    });
    it("should #deserializeTransformChanged() with some values", () => {
      const writer = createCursorView();
      const state = mockGameState();

      const node = new RemoteNode(state.resourceManager);
      const eid = node.eid;
      const physics = getModule(state, PhysicsModule);

      addPhysicsBody(
        state.world,
        physics,
        node,
        new RemotePhysicsBody(state.resourceManager, {
          type: PhysicsBodyType.Rigid,
        })
      );

      node.position.set([0, 2, 0]);
      node.quaternion.set([4, 0, 6, 0]);

      serializeTransformChanged(writer, node);

      node.position.set([0, 0, 0]);
      node.quaternion.set([0, 0, 0, 0]);

      const reader = createCursorView(writer.buffer);

      deserializeTransformChanged(reader, eid, node);

      strictEqual(Networked.position[eid][0], 0);
      strictEqual(Networked.position[eid][1], 2);
      strictEqual(Networked.position[eid][2], 0);

      strictEqual(Networked.quaternion[eid][0], 4);
      strictEqual(Networked.quaternion[eid][1], 0);
      strictEqual(Networked.quaternion[eid][2], 6);
      strictEqual(Networked.quaternion[eid][3], 0);
    });
  });
  describe("updates serialization", () => {
    beforeEach(clearComponentData);
    it("should #serializeUpdatesSnapshot()", () => {
      const writer = createCursorView();
      const state = mockGameState();
      const physics = getModule(state, PhysicsModule);

      const nodes = Array(3)
        .fill(0)
        .map(() => {
          const node = new RemoteNode(state.resourceManager);
          const eid = node.eid;

          addPhysicsBody(
            state.world,
            physics,
            node,
            new RemotePhysicsBody(state.resourceManager, {
              type: PhysicsBodyType.Rigid,
            })
          );

          node.position.set([1, 2, 3]);
          node.quaternion.set([4, 5, 6, 7]);
          node.physicsBody?.velocity.set([1, 2, 3]);
          addComponent(state.world, Networked, eid);
          Networked.networkId[eid] = eid;
          addComponent(state.world, Owned, eid);
          return node;
        });

      serializeUpdatesSnapshot(state, writer);

      const reader = createCursorView(writer.buffer);

      const count = readUint32(reader);
      strictEqual(count, 3);

      nodes.forEach((node) => {
        const nid = Networked.networkId[node.eid];
        strictEqual(nid, readUint32(reader));

        const position = node.position;
        strictEqual(position[0], readFloat32(reader));
        strictEqual(position[1], readFloat32(reader));
        strictEqual(position[2], readFloat32(reader));

        const velocity = node.physicsBody!.velocity;
        strictEqual(velocity[0], readFloat32(reader));
        strictEqual(velocity[1], readFloat32(reader));
        strictEqual(velocity[2], readFloat32(reader));

        const quaternion = node.quaternion;
        strictEqual(quaternion[0], readFloat32(reader));
        strictEqual(quaternion[1], readFloat32(reader));
        strictEqual(quaternion[2], readFloat32(reader));
        strictEqual(quaternion[3], readFloat32(reader));

        const skipLerp = node.skipLerp;
        strictEqual(skipLerp, readUint32(reader));
      });
    });
    it("should #deserializeUpdatesSnapshot()", () => {
      const state = mockGameState();
      const network = getModule(state, NetworkModule);
      const writer = createCursorView();

      const nodes = Array(3)
        .fill(0)
        .map(() => {
          const node = new RemoteNode(state.resourceManager);
          const eid = node.eid;
          const physics = getModule(state, PhysicsModule);

          addPhysicsBody(
            state.world,
            physics,
            node,
            new RemotePhysicsBody(state.resourceManager, {
              type: PhysicsBodyType.Rigid,
            })
          );

          node.position.set([1, 2, 3]);
          node.quaternion.set([4, 5, 6, 7]);
          addComponent(state.world, Networked, eid);
          Networked.networkId[eid] = senderNid(eid);
          network.networkIdToEntityId.set(senderNid(eid), eid);
          addComponent(state.world, Owned, eid);
          return node;
        });

      serializeUpdatesSnapshot(state, writer);

      nodes.forEach((node) => {
        const position = node.position;
        const quaternion = node.quaternion;
        position.set([0, 0, 0]);
        quaternion.set([0, 0, 0, 0]);
      });

      const reader = createCursorView(writer.buffer);

      network.peerIdToIndex.set(SENDER, SENDER_INDEX);
      deserializeUpdatesSnapshot(state, reader, SENDER);

      nodes.forEach((node) => {
        const position = Networked.position[node.eid];
        const quaternion = Networked.quaternion[node.eid];
        strictEqual(position[0], 1);
        strictEqual(position[1], 2);
        strictEqual(position[2], 3);
        strictEqual(quaternion[0], 4);
        strictEqual(quaternion[1], 5);
        strictEqual(quaternion[2], 6);
        strictEqual(quaternion[3], 7);
      });
    });
    it("applies the positions in a new peer's snapshot (someone who hasn't moved since we arrived)", () => {
      const state = mockGameState();
      const network = getModule(state, NetworkModule);
      const writer = createCursorView();

      const node = new RemoteNode(state.resourceManager);
      const eid = node.eid;
      addPhysicsBody(
        state.world,
        getModule(state, PhysicsModule),
        node,
        new RemotePhysicsBody(state.resourceManager, { type: PhysicsBodyType.Rigid })
      );
      node.position.set([1.5, 0, 2]);
      node.quaternion.set([0, 0, 0, 1]);
      addComponent(state.world, Networked, eid);
      Networked.networkId[eid] = senderNid(eid);
      network.networkIdToEntityId.set(senderNid(eid), eid);
      addComponent(state.world, Owned, eid);

      // A new-peer snapshot: no creates (the entity already exists here), then everyone's positions.
      writeUint32(writer, 0);
      serializeUpdatesSnapshot(state, writer);
      Networked.position[eid].set([0, 0, 0]);

      network.peerIdToIndex.set(SENDER, SENDER_INDEX);
      deserializeNewPeerSnapshot(state, createCursorView(writer.buffer), SENDER);

      strictEqual(Networked.position[eid][0], 1.5);
      strictEqual(Networked.position[eid][2], 2);
    });
    it("should #serializeUpdatesChanged()", () => {
      const state = mockGameState();
      const writer = createCursorView();

      const nodes = Array(3)
        .fill(0)
        .map(() => {
          const node = new RemoteNode(state.resourceManager);
          const eid = node.eid;
          const physics = getModule(state, PhysicsModule);

          addPhysicsBody(
            state.world,
            physics,
            node,
            new RemotePhysicsBody(state.resourceManager, {
              type: PhysicsBodyType.Rigid,
            })
          );

          node.position.set([1, 2, 3]);
          node.quaternion.set([4, 5, 6, 7]);
          addComponent(state.world, Networked, eid);
          Networked.networkId[eid] = eid;
          addComponent(state.world, Owned, eid);
          node.skipLerp = 0;
          return node;
        });

      serializeUpdatesChanged(state, writer);

      const reader = createCursorView(writer.buffer);

      const count = readUint32(reader);
      strictEqual(count, 3);

      nodes.forEach((node) => {
        const nid = Networked.networkId[node.eid];
        strictEqual(nid, readUint32(reader));

        const changeMask = readUint16(reader);
        strictEqual(changeMask, 0b1111000111, `Expected ${toBinaryString(changeMask)} to equal 0b1111000111`);

        const position = node.position;
        strictEqual(position[0], readFloat32(reader));
        strictEqual(position[1], readFloat32(reader));
        strictEqual(position[2], readFloat32(reader));

        const quaternion = node.quaternion;
        strictEqual(quaternion[0], readFloat32(reader));
        strictEqual(quaternion[1], readFloat32(reader));
        strictEqual(quaternion[2], readFloat32(reader));
        strictEqual(quaternion[3], readFloat32(reader));
      });
    });
    it("should #deserializeUpdatesChanged()", () => {
      const state = mockGameState();
      const network = getModule(state, NetworkModule);
      const writer = createCursorView();

      const nodes = Array(3)
        .fill(0)
        .map(() => {
          const node = new RemoteNode(state.resourceManager);
          const eid = node.eid;
          const physics = getModule(state, PhysicsModule);

          addPhysicsBody(
            state.world,
            physics,
            node,
            new RemotePhysicsBody(state.resourceManager, {
              type: PhysicsBodyType.Rigid,
            })
          );

          node.position.set([1, 2, 3]);
          node.quaternion.set([4, 5, 6, 7]);
          addComponent(state.world, Networked, eid);
          Networked.networkId[eid] = senderNid(eid);
          network.networkIdToEntityId.set(senderNid(eid), eid);
          addComponent(state.world, Owned, eid);
          return node;
        });

      serializeUpdatesChanged(state, writer);

      const reader = createCursorView(writer.buffer);

      network.peerIdToIndex.set(SENDER, SENDER_INDEX);
      deserializeUpdatesChanged(state, reader, SENDER);

      nodes.forEach((node) => {
        const position = Networked.position[node.eid];
        const quaternion = Networked.quaternion[node.eid];
        strictEqual(position[0], 1);
        strictEqual(position[1], 2);
        strictEqual(position[2], 3);
        strictEqual(quaternion[0], 4);
        strictEqual(quaternion[1], 5);
        strictEqual(quaternion[2], 6);
      });
    });
  });
  describe("creates serialization", () => {
    it("carries a stock prefab's create data (a cloned Thing's variables) to the other peer", () => {
      const state = mockGameState();
      const network = getModule(state, NetworkModule);
      const received: (ArrayBuffer | undefined)[] = [];
      registerPrefab(state, {
        name: "test-thing",
        type: PrefabType.Object,
        create: (ctx: GameContext, options?: { createData?: ArrayBuffer }) => {
          received.push(options?.createData);
          return new RemoteNode(ctx.resourceManager);
        },
      });

      const node = new RemoteNode(state.resourceManager);
      addComponent(state.world, Owned, node.eid);
      addComponent(state.world, Networked, node.eid);
      Networked.networkId[node.eid] = senderNid(node.eid);
      addPrefabComponent(state.world, node.eid, "test-thing");
      PrefabCreateData.set(node.eid, new Uint8Array([1, 2, 3, 4, 5]).buffer);

      const writer = createCursorView();
      serializeCreates(state, writer);
      network.peerIdToIndex.set(SENDER, SENDER_INDEX);
      deserializeCreates(state, createCursorView(writer.buffer), SENDER);

      strictEqual(received.length, 1);
      ok(received[0]);
      strictEqual(Array.from(new Uint8Array(received[0] as ArrayBuffer)).join(","), "1,2,3,4,5");
      // Kept for the receiving peer too, so it's passed on if that peer later owns the object.
      const remote = network.networkIdToEntityId.get(senderNid(node.eid));
      ok(remote !== undefined && PrefabCreateData.has(remote));
    });
    it("should #serializeCreates()", () => {
      const state = mockGameState();
      const writer = createCursorView();

      const ents = Array(3)
        .fill(0)
        .map(() => {
          const node = new RemoteNode(state.resourceManager);
          return node;
        });

      ents.forEach(({ eid }) => {
        addComponent(state.world, Networked, eid);
        Networked.networkId[eid] = eid;
        addComponent(state.world, Owned, eid);
        addPrefabComponent(state.world, eid, "test-prefab");
      });

      strictEqual(ownedNetworkedQuery(state.world).length, 3);

      serializeCreates(state, writer);

      const reader = createCursorView(writer.buffer);

      const count = readUint32(reader);
      strictEqual(count, 3);

      ents.forEach(({ eid }) => {
        strictEqual(readUint32(reader), eid);
        strictEqual(readString(reader), "test-prefab");
        skipUint32(reader); // Data length
      });
    });
    it("should #deserializeCreates()", () => {
      const state = mockGameState();
      const network = getModule(state, NetworkModule);

      const writer = createCursorView();

      const ents = Array(3)
        .fill(0)
        .map(() => {
          const node = new RemoteNode(state.resourceManager);
          return node;
        });

      ents.forEach(({ eid }) => {
        addComponent(state.world, Owned, eid);
        addComponent(state.world, Networked, eid);
        Networked.networkId[eid] = senderNid(eid);
        addPrefabComponent(state.world, eid, "test-prefab");
      });

      const localEntities = ownedNetworkedQuery(state.world);
      strictEqual(localEntities.length, 3);

      strictEqual(remoteNetworkedQuery(state.world).length, 0);

      serializeCreates(state, writer);

      const reader = createCursorView(writer.buffer);

      network.peerIdToIndex.set(SENDER, SENDER_INDEX);
      deserializeCreates(state, reader, SENDER);

      const remoteEntities = remoteNetworkedQuery(state.world);
      strictEqual(remoteEntities.length, 3);

      for (let i = 0; i < remoteEntities.length; i++) {
        const incomingEid = remoteEntities[i];
        const outgoingEid = localEntities[i];

        ok(incomingEid !== outgoingEid);

        strictEqual(Networked.networkId[incomingEid], senderNid(outgoingEid));
        strictEqual(network.networkIdToEntityId.get(senderNid(outgoingEid)), incomingEid);
      }
    });
  });
  describe("deletes serialization", () => {
    it("should #serializeDeletes()", () => {
      const state = mockGameState();
      const writer = createCursorView();

      const ents = Array(3)
        .fill(0)
        .map(() => {
          const node = new RemoteNode(state.resourceManager);
          return node;
        });

      ents.forEach(({ eid }) => {
        addComponent(state.world, Networked, eid);
        Networked.networkId[eid] = eid;
        addComponent(state.world, Owned, eid);
        addPrefabComponent(state.world, eid, "test-prefab");
      });

      strictEqual(ownedNetworkedQuery(state.world).length, 3);

      ents.forEach(({ eid }) => {
        // todo: default removeComponent to not clear component data
        removeComponent(state.world, Networked, eid, false);
      });

      serializeDeletes(state, writer);

      const reader = createCursorView(writer.buffer);

      const count = readUint32(reader);
      strictEqual(count, 3);

      ents.forEach(({ eid }) => {
        strictEqual(readUint32(reader), eid);
      });
    });
    it("should #deserializeDeletes()", () => {
      const state = mockGameState();
      const writer = createCursorView();

      const ents = Array(3)
        .fill(0)
        .map(() => {
          const node = new RemoteNode(state.resourceManager);
          return node;
        });

      ents.forEach(({ eid }) => {
        addComponent(state.world, Networked, eid);
        Networked.networkId[eid] = senderNid(eid);
        addComponent(state.world, Owned, eid);
        addPrefabComponent(state.world, eid, "test-prefab");
      });

      strictEqual(ownedNetworkedQuery(state.world).length, 3);

      serializeCreates(state, writer);

      const reader = createCursorView(writer.buffer);

      getModule(state, NetworkModule).peerIdToIndex.set(SENDER, SENDER_INDEX);
      deserializeCreates(state, reader, SENDER);

      const remoteEntities = remoteNetworkedQuery(state.world);
      strictEqual(remoteEntities.length, 3);

      ents.forEach((node) => {
        removeComponent(state.world, Networked, node.eid, false);
      });

      strictEqual(ownedNetworkedQuery(state.world).length, 0);

      // todo: make queue
      // strictEqual(deletedOwnedNetworkedQuery(state.world).length, 3);

      const writer2 = createCursorView();

      serializeDeletes(state, writer2);

      remoteEntities.forEach((eid) => {
        ok(entityExists(state.world, eid));
      });

      const reader2 = createCursorView(writer2.buffer);

      deserializeDeletes(state, reader2, SENDER);

      remoteEntities.forEach((eid) => {
        ok(getEntityComponents(state.world, eid).length === 0);
      });
    });
  });
});
