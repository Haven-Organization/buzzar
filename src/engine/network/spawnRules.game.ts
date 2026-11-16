/**
 * Buzzar: enforcing world object rules and network ownership on what peers send.
 *
 * There's no server, so every honest client checks incoming messages itself: a peer can only create, move,
 * rename or delete objects whose network ID carries *its own* peer index, can only claim to be itself, and can
 * only spawn stock objects the world allows, up to the per-person limit. Anything else is dropped (so a modified
 * client only sees its junk on its own screen) and reported to the UI, which tells moderators.
 */
import { defineComponent, hasComponent } from "bitecs";

import { GameContext } from "../GameTypes";
import { defineModule, getModule, registerMessageHandler, Thread } from "../module/module.common";
import { Prefab } from "../prefab/prefab.game";
import { getRemoteResource } from "../resource/resource.game";
import { RemoteNode, removeObjectFromWorld } from "../resource/RemoteResources";
import { Player } from "../player/Player";
import { createDisposables } from "../utils/createDisposables";
import { GameNetworkState, getPeerIndexFromNetworkId, NetworkModule } from "./network.game";
import {
  SetSpawnRulesMessage,
  SpawnRules,
  SpawnRulesMessageType,
  SpawnRuleViolationMessage,
  STOCK_SPAWNABLES,
} from "./spawnRules.common";

const STOCK = new Set<string>(STOCK_SPAWNABLES);
/** Player rig parts: never something another peer may take or remove. */
const PLAYER_PREFABS = new Set(["avatar", "xr-head", "xr-hand-left", "xr-hand-right", "xr-ray"]);
/** Report the same peer and reason at most this often (ms). */
const REPORT_INTERVAL = 10000;
/** How long a peer's "I took this object" credit waits for the matching create (ms). */
const TAKE_CREDIT_MS = 10000;

/**
 * An object someone took from another player (grabbed it). It doesn't count toward the taker's per-person limit:
 * taking moves an object between people, it doesn't add one. A component, so it goes away with the entity.
 */
export const TakenObject = defineComponent();

interface SpawnRulesState {
  rules: SpawnRules;
  lastReport: Map<string, number>;
  listeners: Set<() => void>;
  /** Per peer: objects it took (prefab, when), waiting for its create of the copy. */
  takeCredits?: Map<string, { prefab: string; at: number }[]>;
}

export const SpawnRulesModule = defineModule<GameContext, SpawnRulesState>({
  name: "spawn-rules",
  create() {
    return { rules: {}, lastReport: new Map(), listeners: new Set() };
  },
  init(ctx) {
    return createDisposables([
      registerMessageHandler(ctx, SpawnRulesMessageType.SetSpawnRules, (ctx, message: SetSpawnRulesMessage) =>
        setSpawnRules(ctx, message.rules)
      ),
    ]);
  },
});

export function getSpawnRules(ctx: GameContext) {
  return getModule(ctx, SpawnRulesModule).rules;
}

/** Called when the rules change (e.g. to update the action bar). */
export function onSpawnRulesChanged(ctx: GameContext, listener: () => void) {
  const { listeners } = getModule(ctx, SpawnRulesModule);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isStockSpawnable(prefab: string) {
  return STOCK.has(prefab);
}

export function isSpawnAllowed(rules: SpawnRules, prefab: string) {
  return !STOCK.has(prefab) || !rules.allowed || rules.allowed.includes(prefab);
}

/** Stock objects a peer index spawned (not ones it took from others) that are currently out. */
export function countStockObjects(ctx: GameContext, network: GameNetworkState, peerIndex: number) {
  let count = 0;
  for (const [nid, eid] of network.networkIdToEntityId) {
    if (getPeerIndexFromNetworkId(nid) !== peerIndex) continue;
    if (hasComponent(ctx.world, TakenObject, eid)) continue;
    const prefab = Prefab.get(eid);
    if (prefab && STOCK.has(prefab)) count++;
  }
  return count;
}

/** A peer took (grabbed) one of someone's objects: its next create of that type is the moved copy. */
export function grantTakeCredit(ctx: GameContext, peerId: string, prefab: string) {
  const module = getModule(ctx, SpawnRulesModule);
  const credits = (module.takeCredits ??= new Map());
  const list = credits.get(peerId) ?? [];
  list.push({ prefab, at: Date.now() });
  credits.set(peerId, list.slice(-20));
}

/** Uses up a matching take credit, if the peer has one. */
function consumeTakeCredit(ctx: GameContext, peerId: string, prefab: string) {
  const list = getModule(ctx, SpawnRulesModule).takeCredits?.get(peerId);
  if (!list) return false;
  const now = Date.now();
  const index = list.findIndex((credit) => credit.prefab === prefab && now - credit.at < TAKE_CREDIT_MS);
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}

function setSpawnRules(ctx: GameContext, rules: SpawnRules) {
  const module = getModule(ctx, SpawnRulesModule);
  module.rules = rules;
  // Objects of types the world no longer allows disappear for everyone (each client removes them).
  const network = getModule(ctx, NetworkModule);
  for (const [nid, eid] of [...network.networkIdToEntityId]) {
    const prefab = Prefab.get(eid);
    if (!prefab || isSpawnAllowed(rules, prefab)) continue;
    const node = getRemoteResource<RemoteNode>(ctx, eid);
    if (node) removeObjectFromWorld(ctx, node);
    network.networkIdToEntityId.delete(nid);
  }
  for (const listener of module.listeners) listener();
}

/** Whether `peerId` owns network ID `nid` (its peer index is in the ID's low bits). */
export function peerOwnsNetworkId(network: GameNetworkState, peerId: string | undefined, nid: number) {
  if (!peerId) return false;
  const index = network.peerIdToIndex.get(peerId);
  return index !== undefined && getPeerIndexFromNetworkId(nid) === index;
}

/**
 * Whether a peer's create can be accepted: `reject` says why not; `taken` means it's the copy of an object the peer
 * just took from someone (exempt from the per-person limit; mark it TakenObject once created).
 */
export function checkCreate(
  ctx: GameContext,
  network: GameNetworkState,
  peerId: string,
  nid: number,
  prefab: string,
  knownPrefab: boolean
): { reject?: string; taken?: boolean } {
  if (!peerOwnsNetworkId(network, peerId, nid)) return { reject: "created an object under someone else's ID" };
  if (!knownPrefab) return { reject: `spawned an unknown object type "${prefab.slice(0, 60)}"` };
  if (!STOCK.has(prefab)) return {};
  const rules = getSpawnRules(ctx);
  if (!isSpawnAllowed(rules, prefab)) return { reject: `spawned "${prefab}", which this world doesn't allow` };
  if (consumeTakeCredit(ctx, peerId, prefab)) return { taken: true };
  const index = network.peerIdToIndex.get(peerId)!;
  if (rules.maxPerUser !== undefined && countStockObjects(ctx, network, index) >= rules.maxPerUser) {
    return { reject: `went over this world's limit of ${rules.maxPerUser} objects per person` };
  }
  return {};
}

/** Whether a peer may take (grab) the object `eid` from its owner. Never a player's rig. */
export function canTakeObject(ctx: GameContext, eid: number) {
  if (hasComponent(ctx.world, Player, eid)) return false;
  const prefab = Prefab.get(eid);
  return !!prefab && !PLAYER_PREFABS.has(prefab);
}

/** Tells the UI (rate-limited per peer and reason); the UI shows moderators a notice. */
export function reportViolation(ctx: GameContext, peerId: string, reason: string) {
  const { lastReport } = getModule(ctx, SpawnRulesModule);
  const key = `${peerId}\n${reason}`;
  const now = Date.now();
  if (now - (lastReport.get(key) ?? 0) < REPORT_INTERVAL) return;
  lastReport.set(key, now);
  console.warn(`[world rules] blocked ${peerId}: ${reason}`);
  ctx.sendMessage<SpawnRuleViolationMessage>(Thread.Main, {
    type: SpawnRulesMessageType.SpawnRuleViolation,
    peerId,
    reason,
  });
}
