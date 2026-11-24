/**
 * Buzzar: avatar culling on the game thread (avatarCulling.common.ts): a few times a second, works out whose avatars
 * to hide from how far each player is from us. AvatarSystem then doesn't load them and shows the placeholder instead.
 */
import { mat4, vec3 } from "gl-matrix";

import { GameContext } from "../GameTypes";
import { defineModule, getModule, registerMessageHandler } from "../module/module.common";
import { NetworkModule } from "../network/network.game";
import { ourPlayerQuery } from "../player/Player";
import { RemoteNode } from "../resource/RemoteResources";
import { getRemoteResource } from "../resource/resource.game";
import {
  AvatarCullingMessage,
  AvatarCullingMessageType,
  AvatarCullingSettings,
  CullCandidate,
  decideCulled,
  DEFAULT_AVATAR_CULLING,
} from "./avatarCulling.common";

const UPDATE_SECONDS = 0.25;

interface AvatarCullingState {
  settings: AvatarCullingSettings;
  alwaysShow: Set<string>;
  /** Peers whose avatars are hidden now. */
  culled: Set<string>;
  sinceUpdate: number;
}

export const AvatarCullingModule = defineModule<GameContext, AvatarCullingState>({
  name: "avatar-culling",
  create() {
    return { settings: DEFAULT_AVATAR_CULLING, alwaysShow: new Set(), culled: new Set(), sinceUpdate: Infinity };
  },
  init(ctx) {
    return registerMessageHandler(ctx, AvatarCullingMessage, (ctx, message: AvatarCullingMessageType) => {
      const state = getModule(ctx, AvatarCullingModule);
      state.settings = message.settings;
      state.alwaysShow = new Set(message.alwaysShow);
      state.sinceUpdate = Infinity; // apply now
    });
  },
});

/** Whether this player's avatar is hidden by avatar culling. */
export function isAvatarCulled(ctx: GameContext, peerId: string): boolean {
  return getModule(ctx, AvatarCullingModule).culled.has(peerId);
}

const _ours = vec3.create();
const _theirs = vec3.create();

export function AvatarCullingSystem(ctx: GameContext) {
  const state = getModule(ctx, AvatarCullingModule);
  state.sinceUpdate += ctx.dt;
  if (state.sinceUpdate < UPDATE_SECONDS) return;
  state.sinceUpdate = 0;

  const ourEid = ourPlayerQuery(ctx.world)[0];
  const ourNode = ourEid !== undefined ? getRemoteResource<RemoteNode>(ctx, ourEid) : undefined;
  if (!ourNode) {
    state.culled.clear();
    return;
  }
  mat4.getTranslation(_ours, ourNode.worldMatrix as unknown as mat4);

  const candidates: CullCandidate[] = [];
  for (const [peerId, eid] of getModule(ctx, NetworkModule).peerIdToEntityId) {
    const node = getRemoteResource<RemoteNode>(ctx, eid);
    if (!node) continue;
    mat4.getTranslation(_theirs, node.worldMatrix as unknown as mat4);
    candidates.push({ peerId, distance: vec3.distance(_ours, _theirs) });
  }
  state.culled = decideCulled(candidates, state.settings, state.alwaysShow, state.culled);
}
