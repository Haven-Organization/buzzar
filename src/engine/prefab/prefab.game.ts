import { addComponent, defineQuery, exitQuery } from "bitecs";

import { GameContext, World } from "../GameTypes";
import { defineModule, getModule } from "../module/module.common";
import { RemoteNode } from "../resource/RemoteResources";

interface PrefabModuleState {
  prefabTemplateMap: Map<string, PrefabTemplate>;
}

export const PrefabModule = defineModule<GameContext, PrefabModuleState>({
  name: "prefab",
  create() {
    return {
      prefabTemplateMap: new Map(),
    };
  },
  init() {},
});

/* Prefab Functions */

export enum PrefabType {
  Object,
  Avatar,
}

export interface PrefabTemplate {
  name: string;
  type: PrefabType;
  create: (ctx: GameContext, options?: any) => RemoteNode;
  delete?: (ctx: GameContext) => number;
  serialize?: (ctx: GameContext) => number;
  deserialize?: (ctx: GameContext) => number;
}

export const Prefab: Map<number, string> = new Map();

/**
 * Buzzar: extra data an object of a stock prefab was created with (e.g. a cloned Item's variables), sent with its
 * create message so other peers build the same item. Cleared when the entity goes away.
 */
export const PrefabCreateData: Map<number, ArrayBuffer> = new Map();

/**
 * Buzzar: makes prefab templates on demand for names that aren't registered up front, such as a custom Item's file
 * (its mxc:// URI). Returns undefined for names it doesn't handle.
 */
export type PrefabResolver = (ctx: GameContext, name: string) => PrefabTemplate | undefined;
const resolvers: PrefabResolver[] = [];

export function registerPrefabResolver(resolver: PrefabResolver) {
  resolvers.push(resolver);
  return () => {
    const index = resolvers.indexOf(resolver);
    if (index !== -1) resolvers.splice(index, 1);
  };
}

function resolvePrefab(ctx: GameContext, name: string): PrefabTemplate | undefined {
  const prefabModule = getModule(ctx, PrefabModule);
  const known = prefabModule.prefabTemplateMap.get(name);
  if (known) return known;
  for (const resolver of resolvers) {
    const template = resolver(ctx, name);
    if (template) {
      registerPrefab(ctx, template);
      return prefabModule.prefabTemplateMap.get(name);
    }
  }
  return undefined;
}

export function registerPrefab(ctx: GameContext, template: PrefabTemplate) {
  const prefabModule = getModule(ctx, PrefabModule);
  if (prefabModule.prefabTemplateMap.has(template.name)) {
    console.warn("warning: overwriting existing prefab", template.name);
  }
  prefabModule.prefabTemplateMap.set(template.name, template);
  const create = template.create;

  template.create = (ctx: GameContext, options = {}) => {
    const node = create(ctx, options);
    addPrefabComponent(ctx.world, node.eid, template.name);
    return node;
  };
}

const prefabQuery = defineQuery([Prefab]);
const removedPrefabQuery = exitQuery(prefabQuery);

export function PrefabDisposalSystem(ctx: GameContext) {
  const removed = removedPrefabQuery(ctx.world);

  for (let i = 0; i < removed.length; i++) {
    const eid = removed[i];
    Prefab.delete(eid);
    PrefabCreateData.delete(eid);
  }
}

export function getPrefabTemplate(ctx: GameContext, name: string) {
  const template = resolvePrefab(ctx, name);
  if (!template) throw new Error("could not find template for prefab name: " + name);

  return template;
}

/** Buzzar: whether a prefab name is registered, or can be made on demand (peers may send any string). */
export function hasPrefabTemplate(ctx: GameContext, name: string) {
  return !!resolvePrefab(ctx, name);
}

export const createPrefabEntity = (ctx: GameContext, prefab: string, options = {}): RemoteNode => {
  const create = resolvePrefab(ctx, prefab)?.create;

  if (!create) {
    throw new Error(`Could not find prefab "${prefab}"`);
  }

  return create(ctx, options);
};

export const addPrefabComponent = (world: World, eid: number, prefab: string) => {
  addComponent(world, Prefab, eid);
  Prefab.set(eid, prefab);
};

export const removePrefabComponent = (world: World, eid: number) => {
  addComponent(world, Prefab, eid);
  Prefab.delete(eid);
};
