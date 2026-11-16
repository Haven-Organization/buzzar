/**
 * Buzzar: enforcing world object rules and network ownership on what peers send.
 *
 * There's no server, so every honest client checks incoming messages itself: a peer can only create, move,
 * rename or delete objects whose network ID carries *its own* peer index, can only claim to be itself, and can
 * only spawn stock objects the world allows, up to the per-person limit. Anything else is dropped (so a modified
 * client only sees its junk on its own screen) and reported to the UI, which tells moderators.
 */
import { hasComponent } from "bitecs";

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

interface SpawnRulesState {
  rules: SpawnRules;
  lastReport: Map<string, number>;
  listeners: Set<() => void>;
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

/** Stock objects currently out that belong to a peer index. */
export function countStockObjects(network: GameNetworkState, peerIndex: number) {
  let count = 0;
  for (const [nid, eid] of network.networkIdToEntityId) {
    if (getPeerIndexFromNetworkId(nid) !== peerIndex) continue;
    const prefab = Prefab.get(eid);
    if (prefab && STOCK.has(prefab)) count++;
  }
  return count;
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

/** Why a peer's create can't be accepted, or undefined if it can. */
export function rejectCreate(
  ctx: GameContext,
  network: GameNetworkState,
  peerId: string,
  nid: number,
  prefab: string,
  knownPrefab: boolean
): string | undefined {
  if (!peerOwnsNetworkId(network, peerId, nid)) return "created an object under someone else's ID";
  if (!knownPrefab) return `spawned an unknown object type "${prefab.slice(0, 60)}"`;
  if (!STOCK.has(prefab)) return undefined;
  const rules = getSpawnRules(ctx);
  if (!isSpawnAllowed(rules, prefab)) return `spawned "${prefab}", which this world doesn't allow`;
  const index = network.peerIdToIndex.get(peerId)!;
  if (rules.maxPerUser !== undefined && countStockObjects(network, index) >= rules.maxPerUser) {
    return `went over this world's limit of ${rules.maxPerUser} objects per person`;
  }
  return undefined;
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
