/**
 * Buzzar debug (Third Room #126, world capacity): `thirdroom.spawnCrowd(n)` stands n copies of the default avatar in
 * a grid in front of you, to measure how the frame rate falls as avatars are added (no network involved);
 * `thirdroom.spawnCrowd(0)` removes them. Each copy is a full skinned avatar like another player's.
 */
import { mat4, quat, vec3 } from "gl-matrix";

import { GameContext } from "../GameTypes";
import { defineModule, getModule, registerMessageHandler } from "../module/module.common";
import { ourPlayerQuery } from "../player/Player";
import { addObjectToWorld, removeObjectFromWorld, RemoteNode } from "../resource/RemoteResources";
import { getRemoteResource } from "../resource/resource.game";
import { createDefaultAvatarNode } from "./avatar.game";

export const SpawnCrowdMessage = "software.haven.debug.crowd";

interface TestCrowdState {
  avatars: RemoteNode[];
}

/** Metres between avatars in the grid. */
const SPACING = 1.2;

const _ours = vec3.create();
const _forward = vec3.create();
const _right = vec3.create();
const _rotation = quat.create();

function spawnCrowd(ctx: GameContext, count: number) {
  const state = getModule(ctx, TestCrowdModule);
  for (const avatar of state.avatars) removeObjectFromWorld(ctx, avatar);
  state.avatars = [];
  if (count <= 0) return;

  const ourEid = ourPlayerQuery(ctx.world)[0];
  const ours = ourEid !== undefined ? getRemoteResource<RemoteNode>(ctx, ourEid) : undefined;
  if (!ours) return;
  const matrix = ours.worldMatrix as unknown as mat4;
  mat4.getTranslation(_ours, matrix);
  mat4.getRotation(_rotation, matrix);
  vec3.transformQuat(_forward, [0, 0, -1], _rotation);
  _forward[1] = 0;
  vec3.normalize(_forward, _forward);
  vec3.set(_right, -_forward[2], 0, _forward[0]);

  // Rows of up to 10, starting 4 m ahead, facing us.
  const perRow = Math.min(10, count);
  const yaw = Math.atan2(_forward[0], _forward[2]);
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const col = (i % perRow) - (perRow - 1) / 2;
    const avatar = createDefaultAvatarNode(ctx);
    avatar.name = `Crowd ${i + 1}`;
    avatar.position.set([
      _ours[0] + _forward[0] * (4 + row * SPACING) + _right[0] * col * SPACING,
      _ours[1],
      _ours[2] + _forward[2] * (4 + row * SPACING) + _right[2] * col * SPACING,
    ]);
    quat.fromEuler(avatar.quaternion, 0, (yaw * 180) / Math.PI, 0);
    addObjectToWorld(ctx, avatar);
    state.avatars.push(avatar);
  }
}

export const TestCrowdModule = defineModule<GameContext, TestCrowdState>({
  name: "test-crowd",
  create() {
    return { avatars: [] };
  },
  init(ctx) {
    return registerMessageHandler(ctx, SpawnCrowdMessage, (ctx: GameContext, message: { type: typeof SpawnCrowdMessage; count: number }) =>
      spawnCrowd(ctx, Math.max(0, Math.min(200, Math.round(message.count))))
    );
  },
});
