import { defineConfig } from "../module/module.common";
import { RendererModule } from "./renderer.render";
import { ScreenShareRenderModule, ScreenShareRenderSystem } from "../screenshare/screenShare.render";
import { ResourceModule, ResourceLoaderSystem, ReturnRecycledResourcesSystem } from "./RenderResources";
import { UpdateRendererMaterialSystem } from "./systems/UpdateRendererMaterialSystem";
import { UpdateRendererMeshPrimitivesSystem } from "./systems/UpdateRendererMeshPrimitivesSystem";
import { PhysicsDebugRenderSystem } from "./systems/PhysicsDebugRenderSystem";
import { RenderSubmitSystem } from "./systems/RenderSubmitSystem";
import { RendererIncomingTripleBufferSystem } from "./systems/RendererIncomingTripleBufferSystem";
import { RendererOutgoingTripleBufferSystem } from "./systems/RendererOutgoingTripleBufferSystem";
import { ResizeViewportSystem } from "./systems/ResizeViewportSystem";
import { LoadImageResourcesSystem } from "./systems/LoadImageResourcesSystem";
import { LoadTextureResourcesSystem } from "./systems/LoadTextureResourcesSystem";
import { UpdateDynamicAccessorsSystem } from "./systems/UpdateDynamicAccessorsSystem";
import { UpdateWorldVisibilitySystem } from "./systems/UpdateWorldVisibilitySystem";
import { UpdateActiveSceneResourceSystem } from "./systems/UpdateActiveSceneResourceSystem";
import { UpdateNodeResourcesSystem } from "./systems/UpdateNodeResourcesSystem";
import { UpdateTileRenderersSystem } from "./systems/UpdateTileRenderersSystem";
import { UpdateReflectionProbesSystem } from "./systems/UpdateReflectionProbesSystem";
import { UpdateNodeReflectionsSystem } from "./systems/UpdateNodeReflectionsSystem";
import { UpdateNodesFromXRPosesSystem } from "./systems/UpdateNodesFromXRPosesSystem";
import { RenderThreadStatsSystem } from "./systems/RenderThreadStatsSystem";
import { DynamicResolutionSystem } from "./systems/DynamicResolutionSystem";
import { AutoInstancingSystem } from "./systems/AutoInstancingSystem";
import { WorldShadowsSystem } from "./systems/WorldShadowsSystem";
import { WorldMapCaptureSystem } from "./systems/WorldMapCaptureSystem";
import { ShaderWarmupSystem } from "./systems/ShaderWarmupSystem";
import { UpdateXRInputSourcesSystem } from "./systems/UpdateXRInputSourcesSystem";

export default defineConfig({
  modules: [ResourceModule, RendererModule, ScreenShareRenderModule],
  systems: [
    RendererIncomingTripleBufferSystem,
    UpdateXRInputSourcesSystem,
    ResourceLoaderSystem, // Drain dispose queue and create messages. Add eid to recycle queue if disposed.
    UpdateRendererMaterialSystem,
    UpdateRendererMeshPrimitivesSystem,
    PhysicsDebugRenderSystem,
    ResizeViewportSystem,
    // Buzzar: before drawing: changing the pixel ratio clears the canvas, so after drawing it showed a black frame.
    DynamicResolutionSystem,
    LoadImageResourcesSystem,
    LoadTextureResourcesSystem,
    UpdateDynamicAccessorsSystem,
    UpdateWorldVisibilitySystem,
    UpdateActiveSceneResourceSystem,
    UpdateNodeResourcesSystem,
    UpdateTileRenderersSystem,
    UpdateReflectionProbesSystem,
    UpdateNodeReflectionsSystem,
    UpdateNodesFromXRPosesSystem,
    // Buzzar (Third Room #204): shadow settings and sun shadows following the camera; before instancing, which
    // groups meshes by their shadow flags.
    WorldShadowsSystem,
    // Buzzar (Third Room #461): a generated map, when asked for; before instancing, so the world's own meshes can be
    // shown one by one and last frame's instanced copies hidden.
    WorldMapCaptureSystem,
    // Buzzar: compile new shaders in one go rather than whenever something first comes into view.
    ShaderWarmupSystem,
    // Buzzar (Third Room #128): after transforms and reflections are updated, before drawing.
    AutoInstancingSystem,
    // Buzzar (Third Room #398): shared screens glide to where their sharer moved them.
    ScreenShareRenderSystem,
    RenderSubmitSystem,
    RenderThreadStatsSystem,
    RendererOutgoingTripleBufferSystem, // Swap outgoing triplebuffers
    ReturnRecycledResourcesSystem, // Actually enqueue into recycle ringbuffer
  ],
});
