import { removeComponent, addComponent, defineComponent, hasComponent } from "bitecs";

import { PlayerModule } from "./Player.game";
import { ourPlayerQuery } from "./Player";
import { GameContext } from "../GameTypes";
import { ActionMap, ActionType, BindingType, ButtonActionState } from "../input/ActionMap";
import { InputModule } from "../input/input.game";
import { getModule } from "../module/module.common";
import { PhysicsModuleState, PhysicsModule } from "../physics/physics.game";
import { RemoteNode } from "../resource/RemoteResources";
import { tryGetRemoteResource } from "../resource/resource.game";
import { addFlyControls, FLY_TAKEOFF_HEIGHT, FlyControls } from "./FlyCharacterController";
import { getAvatar } from "./getAvatar";
import { getCamera } from "./getCamera";
import { KinematicControls } from "./KinematicCharacterController";
import { setAvatarHiddenFromMainCamera } from "./avatarLayers";

export enum CharacterControllerType {
  FirstPerson = "first-person",
  Fly = "fly",
}

export const CharacterControllerAction = {
  ToggleFlyMode: "toggleFlyMode",
  ToggleThirdPerson: "toggleThirdPerson",
};

export const CharacterControllerActionMap: ActionMap = {
  id: "character-controller",
  actionDefs: [
    {
      id: "toggleFlyMode",
      path: CharacterControllerAction.ToggleFlyMode,
      type: ActionType.Button,
      bindings: [
        {
          type: BindingType.Button,
          path: "Keyboard/KeyB",
        },
      ],
    },
    {
      id: "toggleThirdPerson",
      path: CharacterControllerAction.ToggleThirdPerson,
      type: ActionType.Button,
      bindings: [
        {
          type: BindingType.Button,
          path: "Keyboard/KeyV",
        },
      ],
    },
  ],
};

export interface ISceneCharacterControllerComponent {
  type: CharacterControllerType;
}

export const SceneCharacterControllerComponent: Map<number, ISceneCharacterControllerComponent> = new Map();

function swapToFlyPlayerRig(ctx: GameContext, physics: PhysicsModuleState, node: RemoteNode) {
  removeComponent(ctx.world, KinematicControls, node.eid);
  addFlyControls(ctx, node.eid);
  FlyControls.get(node.eid)!.lift = FLY_TAKEOFF_HEIGHT;
}

function swapToPlayerRig(ctx: GameContext, physics: PhysicsModuleState, node: RemoteNode) {
  removeComponent(ctx.world, FlyControls, node.eid);
  addComponent(ctx.world, KinematicControls, node.eid);
}

/**
 * Buzzar (Third Room #615): a world script's choice of character controller for your player (world.
 * setCharacterController): walk, fly, or none (you stay where you are; you can still look around). While set, the
 * fly toggle (B) doesn't change it. Cleared (undefined) when the script goes away.
 */
export type ScriptCharacterController = "walk" | "fly" | "none";
let scriptCharacterController: ScriptCharacterController | undefined;

export function setScriptCharacterController(ctx: GameContext, type: ScriptCharacterController | undefined) {
  scriptCharacterController = type;
  if (type) return; // applied by EnableCharacterControllerSystem, also after a respawn
  // Back to the world's own choice.
  const eid = ourPlayerQuery(ctx.world)[0];
  const player = eid ? tryGetRemoteResource<RemoteNode>(ctx, eid) : undefined;
  if (!player) return;
  const sceneType = ctx.worldResource.environment?.publicScene
    ? SceneCharacterControllerComponent.get(ctx.worldResource.environment.publicScene.eid)?.type
    : undefined;
  if (sceneType === CharacterControllerType.Fly) swapToFlyPlayerRig(ctx, getModule(ctx, PhysicsModule), player);
  else swapToPlayerRig(ctx, getModule(ctx, PhysicsModule), player);
}

function applyScriptCharacterController(ctx: GameContext, physics: PhysicsModuleState, player: RemoteNode) {
  const flying = hasComponent(ctx.world, FlyControls, player.eid);
  const walking = hasComponent(ctx.world, KinematicControls, player.eid);
  if (scriptCharacterController === "walk" && !walking) swapToPlayerRig(ctx, physics, player);
  else if (scriptCharacterController === "fly" && !flying) swapToFlyPlayerRig(ctx, physics, player);
  else if (scriptCharacterController === "none" && (flying || walking)) {
    removeComponent(ctx.world, FlyControls, player.eid);
    removeComponent(ctx.world, KinematicControls, player.eid);
  }
}

export const ThirdPersonComponent = defineComponent();

function swapToThirdPerson(ctx: GameContext, node: RemoteNode) {
  addComponent(ctx.world, ThirdPersonComponent, node.eid);
  const camera = getCamera(ctx, node);
  camera.position[2] = 2;
  camera.parent!.position[0] = 0.4;

  const avatar = getAvatar(ctx, node);
  setAvatarHiddenFromMainCamera(avatar, false);
}

function swapToFirstPerson(ctx: GameContext, node: RemoteNode) {
  removeComponent(ctx.world, ThirdPersonComponent, node.eid);
  const camera = getCamera(ctx, node);
  camera.position[2] = 0;
  camera.parent!.position[0] = 0;

  const avatar = getAvatar(ctx, node);
  setAvatarHiddenFromMainCamera(avatar, true);
}

export function EnableCharacterControllerSystem(ctx: GameContext) {
  const input = getModule(ctx, InputModule);
  const physics = getModule(ctx, PhysicsModule);

  const eid = ourPlayerQuery(ctx.world)[0];

  if (eid) {
    const player = tryGetRemoteResource<RemoteNode>(ctx, eid);
    const toggleFlyMode = input.actionStates.get(CharacterControllerAction.ToggleFlyMode) as ButtonActionState;

    const camRigModule = getModule(ctx, PlayerModule);

    if (camRigModule.orbiting) {
      return;
    }

    if (scriptCharacterController) {
      applyScriptCharacterController(ctx, physics, player);
    } else if (toggleFlyMode.pressed) {
      if (hasComponent(ctx.world, FlyControls, player.eid)) {
        swapToPlayerRig(ctx, physics, player);
      } else {
        swapToFlyPlayerRig(ctx, physics, player);
      }
    }

    const toggleCameraMode = input.actionStates.get(CharacterControllerAction.ToggleThirdPerson) as ButtonActionState;
    if (toggleCameraMode.pressed) {
      if (hasComponent(ctx.world, ThirdPersonComponent, player.eid)) {
        swapToFirstPerson(ctx, player);
      } else {
        swapToThirdPerson(ctx, player);
      }
    }
  }
}
