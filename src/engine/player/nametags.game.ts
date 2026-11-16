import { addComponent, defineComponent, defineQuery, Types } from "bitecs";
import { mat4, vec3 } from "gl-matrix";
import { radToDeg } from "three/src/math/MathUtils";
import RAPIER from "@dimforge/rapier3d-compat";

import { addChild } from "../../engine/component/transform";
import { getForwardVector, getPitch, getYaw } from "../common/math";
import { GameContext } from "../../engine/GameTypes";
import { defineModule, getModule, registerMessageHandler } from "../../engine/module/module.common";
import { projectPerspective } from "../../engine/camera/camera.game";
import { RendererModule } from "../../engine/renderer/renderer.game";
import { NametagsEnableMessage, NametagsEnableMessageType } from "./nametags.common";
import { ourPlayerQuery } from "../../engine/player/Player";
import { getRemoteResource, tryGetRemoteResource } from "../../engine/resource/resource.game";
import { RemoteNametag, RemoteNode } from "../../engine/resource/RemoteResources";
import { PhysicsModule } from "../physics/physics.game";

type NametagState = {
  enabled: boolean;
};

export const NametagModule = defineModule<GameContext, NametagState>({
  name: "nametags",
  create() {
    return {
      enabled: false,
    };
  },
  init(ctx) {
    return registerMessageHandler(ctx, NametagsEnableMessage, onNametagsEnabledMessage);
  },
});

function onNametagsEnabledMessage(ctx: GameContext, message: NametagsEnableMessageType) {
  const nametagModule = getModule(ctx, NametagModule);
  nametagModule.enabled = message.enabled;
}

export const NametagAnchor = defineComponent();

export const NametagRef = defineComponent({ eid: Types.eid });

const nametagAnchorQuery = defineQuery([NametagAnchor]);

const _v = vec3.create();
const _t = vec3.create();
const _forward = vec3.create();

export function NametagSystem(ctx: GameContext) {
  const renderer = getModule(ctx, RendererModule);
  const nametagModule = getModule(ctx, NametagModule);
  const ourPlayerEid = ourPlayerQuery(ctx.world)[0];
  const ourPlayerNode = getRemoteResource<RemoteNode>(ctx, ourPlayerEid);

  if (nametagModule.enabled && ourPlayerNode) {
    const ourWorldPosition = ourPlayerNode.position;

    const nametagAchorEnts = nametagAnchorQuery(ctx.world);
    for (let i = 0; i < nametagAchorEnts.length; i++) {
      const anchorNode = tryGetRemoteResource<RemoteNode>(ctx, nametagAchorEnts[i]);

      if (!ctx.worldResource.activeCameraNode) {
        continue;
      }

      // projection to camera space
      const nametagWorldPosition = mat4.getTranslation(_v, anchorNode.worldMatrix);
      const projected = projectPerspective(renderer, ctx.worldResource.activeCameraNode, nametagWorldPosition);

      const dist = vec3.dist(nametagWorldPosition, ourWorldPosition);

      const quaternion = ourPlayerNode.quaternion;
      const pitch = getPitch(quaternion);
      const roll = getYaw(quaternion);
      const forward = getForwardVector(_forward, pitch, roll);

      const target = vec3.sub(_t, nametagWorldPosition, ourWorldPosition);
      vec3.normalize(target, target);

      const dot = vec3.dot(target, forward);
      const angle = radToDeg(Math.acos(dot));

      const nametag = anchorNode.nametag!;

      // Buzzar: names don't show through walls. Cast from the camera to the tag; only the world's fixed geometry
      // (not players, crates or sensors) hides it.
      const hidden = angle < 100 && isOccluded(ctx, ctx.worldResource.activeCameraNode, nametagWorldPosition);

      if (angle < 100 && !hidden) {
        // projection to screenspace
        const screenX = Math.round((0.5 + projected[0] / 2) * renderer.canvasWidth);
        const screenY = Math.round((0.5 - projected[1] / 2) * renderer.canvasHeight);

        nametag.screenX = screenX;
        nametag.screenY = screenY;
        nametag.distanceFromCamera = dist;
        nametag.inFrustum = true;
      } else {
        nametag.screenX = NaN;
        nametag.screenY = NaN;
        nametag.distanceFromCamera = dist;
        nametag.inFrustum = false;
      }
    }
  }
}

const _from = vec3.create();
const _dir = vec3.create();
const _ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
const blocksNames = (collider: RAPIER.Collider) => !collider.isSensor() && !!collider.parent()?.isFixed();

function isOccluded(ctx: GameContext, cameraNode: RemoteNode, target: vec3) {
  const { physicsWorld } = getModule(ctx, PhysicsModule);
  mat4.getTranslation(_from, cameraNode.worldMatrix);
  vec3.sub(_dir, target, _from);
  const length = vec3.length(_dir);
  if (length < 0.5) return false;
  vec3.scale(_dir, _dir, 1 / length);
  _ray.origin = { x: _from[0], y: _from[1], z: _from[2] };
  _ray.dir = { x: _dir[0], y: _dir[1], z: _dir[2] };
  // Stop a little short of the tag, so something it floats right next to doesn't count.
  const hit = physicsWorld.castRay(_ray, length - 0.3, true, undefined, undefined, undefined, undefined, blocksNames);
  return hit !== null;
}

export function addNametag(ctx: GameContext, height: number, node: RemoteNode, label: string) {
  const nametag = new RemoteNode(ctx.resourceManager, {
    position: [0, height, 0],
    nametag: new RemoteNametag(ctx.resourceManager, {
      name: label,
    }),
  });
  addComponent(ctx.world, NametagAnchor, nametag.eid);
  addChild(node, nametag);
  addComponent(ctx.world, NametagRef, node.eid);
  NametagRef.eid[node.eid] = nametag.eid;
  return nametag;
}

export function getNametag(ctx: GameContext, parent: RemoteNode) {
  const nametagEid = NametagRef.eid[parent.eid];
  if (!nametagEid) throw new Error(`NametagRef not found on node "${parent.name}"`);
  const nametag = tryGetRemoteResource<RemoteNode>(ctx, nametagEid);
  return nametag;
}
