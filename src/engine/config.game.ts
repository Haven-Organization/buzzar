import { defineConfig } from "./module/module.common";
import { AudioModule } from "./audio/audio.game";
import { InputModule } from "./input/input.game";
import { UpdateRawInputSystem, ResetRawInputSystem } from "./input/RawInputSystems";
import { PhysicsModule, PhysicsSystem } from "./physics/physics.game";
import { NetworkExitWorldQueueSystem, NetworkModule } from "./network/network.game";
import { ActionMappingSystem } from "./input/ActionMappingSystem";
import {
  KinematicCharacterControllerModule,
  KinematicCharacterControllerSystem,
} from "./player/KinematicCharacterController";
import { GameWorkerStatsSystem, StatsModule } from "./stats/stats.game";
import {
  EditorModule,
  //EditorSelectionSystem,
  EditorStateSystem,
} from "./editor/editor.game";
import { GameContext } from "./GameTypes";
import { RendererModule } from "./renderer/renderer.game";
import { SpawnablesModule } from "../plugins/spawnables/spawnables.game";
import {
  RecycleResourcesSystem,
  ResourceDisposalSystem,
  ResourceLoaderSystem,
  ResourceModule,
  ResourceTickSystem,
} from "./resource/resource.game";
import { ThirdRoomModule, WorldLoaderSystem } from "../plugins/thirdroom/thirdroom.game";
import { UpdateMatrixWorldSystem } from "./component/transform";
import { FlyCharacterControllerModule, FlyControllerSystem } from "./player/FlyCharacterController";
import { NetworkInterpolationSystem } from "./network/NetworkInterpolationSystem";
import { PrefabDisposalSystem, PrefabModule } from "./prefab/prefab.game";
import { SpawnRulesModule } from "./network/spawnRules.game";
import { AnimationSystem } from "./animation/animation.game";
import {
  InteractionModule,
  InteractionSystem,
  ResetInteractablesSystem,
} from "../plugins/interaction/interaction.game";
import { NametagModule, NametagSystem } from "./player/nametags.game";
import { WorldMapModule, WorldMapSystem } from "../plugins/world-map/worldMap.game";
import { ScriptingSystem } from "./scripting/scripting.game";
import { GameResourceSystem } from "./resource/GameResourceSystem";
import { RemoteCameraSystem } from "./camera/camera.game";
import { InboundNetworkSystem } from "./network/inbound.game";
import { OutboundNetworkSystem } from "./network/outbound.game";
import { GLTFResourceDisposalSystem } from "./gltf/gltf.game";
import { IncomingTripleBufferSystem } from "./resource/IncomingTripleBufferSystem";
import { OutgoingTripleBufferSystem } from "./resource/OutgoingTripleBufferSystem";
import { SkipRenderLerpSystem } from "./component/SkipRenderLerpSystem";
import { SetWebXRReferenceSpaceSystem, WebXRAvatarRigSystem } from "./input/WebXRAvatarRigSystem";
import { XRInteractionSystem } from "../plugins/interaction/XRInteractionSystem";
import { MatrixModule } from "./matrix/matrix.game";
import { WebSGNetworkModule } from "./network/scripting.game";
import { WebSGUIModule } from "./ui/ui.game";
import { PlayerModule } from "./player/Player.game";
import { ActionBarSystem } from "../plugins/thirdroom/action-bar.game";
import { MirrorSystem } from "../plugins/mirrors/mirrors.game";
import { LadderSystem } from "../plugins/ladders/ladders.game";
import { TrampolineObjectSystem } from "./player/trampolineObjects";
import { InteractableHighlightSystem } from "../plugins/interaction/highlight.game";
import { AvatarPedestalModule, AvatarPedestalSystem } from "../plugins/avatar-pedestals/pedestals.game";
import { AvatarModule, AvatarSystem } from "./avatar/avatar.game";
import { AvatarPlaceholderSystem } from "./avatar/placeholder.game";
import { EnableCharacterControllerSystem } from "./player/CharacterController";
import { CameraRigSystem } from "./player/CameraRig";
import { FallRespawnSystem } from "./player/FallRespawnSystem";
import { SeatModule, SeatSystem } from "../plugins/seats/seats.game";
import { PostureModule, PostureSystem } from "../plugins/posture/posture.game";
import { SceneGrabbableModule, SceneGrabbableSystem } from "../plugins/scene-grabbables/grabbables.game";

export default defineConfig<GameContext>({
  modules: [
    PrefabModule,
    ResourceModule,
    InputModule,
    PhysicsModule,
    AudioModule,
    NetworkModule,
    SpawnRulesModule,
    StatsModule,
    EditorModule,
    RendererModule,
    ThirdRoomModule,
    MatrixModule,
    PlayerModule,
    KinematicCharacterControllerModule,
    FlyCharacterControllerModule,
    InteractionModule,
    SpawnablesModule,
    NametagModule,
    WorldMapModule,
    AvatarModule,
    AvatarPedestalModule,
    SeatModule,
    PostureModule,
    SceneGrabbableModule,
    WebSGNetworkModule,
    WebSGUIModule,
  ],
  systems: [
    IncomingTripleBufferSystem,

    UpdateRawInputSystem,

    WebXRAvatarRigSystem,
    ActionMappingSystem,

    InboundNetworkSystem,

    WorldLoaderSystem,

    CameraRigSystem,

    KinematicCharacterControllerSystem,
    FallRespawnSystem,
    FlyControllerSystem,
    SetWebXRReferenceSpaceSystem,
    InteractionSystem,
    XRInteractionSystem,
    InteractableHighlightSystem,
    MirrorSystem,
    LadderSystem,
    AvatarPedestalSystem,
    SeatSystem,
    PostureSystem,
    SceneGrabbableSystem,
    ActionBarSystem,
    EnableCharacterControllerSystem,

    // step physics forward and copy rigidbody data to transform component
    PhysicsSystem,
    // Buzzar: after the step, so it sees objects that just landed on a trampoline.
    TrampolineObjectSystem,

    // interpolate towards authoritative state
    NetworkInterpolationSystem,

    ScriptingSystem,

    AvatarSystem,
    AvatarPlaceholderSystem,
    AnimationSystem,

    UpdateMatrixWorldSystem,

    NametagSystem,
    WorldMapSystem,
    EditorStateSystem,
    //EditorSelectionSystem,

    OutboundNetworkSystem,
    NetworkExitWorldQueueSystem,

    RemoteCameraSystem,
    PrefabDisposalSystem,
    GLTFResourceDisposalSystem,

    ResetInteractablesSystem,
    ResetRawInputSystem,
    GameWorkerStatsSystem,

    GameResourceSystem, // Commit Resources to TripleBuffer
    ResourceTickSystem,
    OutgoingTripleBufferSystem, // Swap write triplebuffers
    RecycleResourcesSystem, // Drain entity recycle queues. Call removeEntity if released by other threads.
    ResourceDisposalSystem, // Drain entity disposal queues. Enqueue into shared ringbuffers.
    ResourceLoaderSystem, // Drain entity creation queue. postMessage to other threads.

    SkipRenderLerpSystem, // Change node.skipLerp after commit
  ],
});
