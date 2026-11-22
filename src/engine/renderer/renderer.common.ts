import { vec3 } from "gl-matrix";

import { defineObjectBufferSchema, ObjectTripleBuffer } from "../allocator/ObjectBufferView";
import { InputRingBuffer } from "../common/InputRingBuffer";
import { XRInputLayout } from "./xr/WebXRInputProfiles";

export const rendererModuleName = "renderer";

export enum RendererMessageType {
  InitializeRenderer = "renderer-initialize-canvas",
  InitializeRendererTripleBuffers = "initialize-renderer-triple-buffers",
  NotifySceneRendered = "renderer-notify-scene-renderer",
  SceneRenderedNotification = "renderer-scene-rendered-notification",
  CanvasResize = "canvas-resize",
  EnableMatrixMaterial = "enable-matrix-material",
  EnterXR = "enter-xr",
  InitializeGameRendererTripleBuffer = "initialize-game-renderer-triple-buffer",
  TogglePhysicsDebug = "toggle-physics-debug",
  PhysicsEnableDebugRender = "physics-enable-debug-render",
  PhysicsDisableDebugRender = "physics-disable-debug-render",
  /** Buzzar (Third Room #204): the world's shadow settings (World Settings → Scene & Script). */
  SetWorldShadows = "set-world-shadows",
  SetNodeOptimizationsEnabled = "set-node-optimizations-enabled",
  PrintRenderThreadState = "print-render-thread-state",
  UICanvasPress = "ui-canvas-press",
  UICanvasFocus = "ui-canvas-focus",
  UIButtonPress = "ui-button-press",
  UIButtonFocus = "ui-button-focus",
  UIButtonUnfocus = "ui-button-unfocus",
  UpdateXRInputSources = "update-xr-input-sources",
  SetXRReferenceSpace = "set-xr-reference-space",
}

export interface InitializeRendererMessage {
  supportedXRSessionModes: XRSessionMode[] | false;
  canvasTarget?: OffscreenCanvas;
  initialCanvasWidth: number;
  initialCanvasHeight: number;
  /** Buzzar: the screen's density (window.devicePixelRatio), which the render worker can't read itself. */
  devicePixelRatio?: number;
  quality: RenderQuality;
  /** Buzzar (Third Room #211): lower the resolution while frames run long (on when render quality is Auto). */
  dynamicResolution?: boolean;
  /** Buzzar (Third Room #267): the Matrix-style reveal as a world appears. */
  worldReveal?: boolean;
  /** Buzzar (Third Room #204): your shadow setting. */
  shadowQuality?: ShadowQualitySetting;
  statsBuffer: RenderStatsBuffer;
  inputRingBuffer: InputRingBuffer;
}

export interface NotifySceneRendererMessage {
  type: RendererMessageType.NotifySceneRendered;
  sceneResourceId: number;
  id: number;
  frames: number;
}

export interface SceneRenderedNotificationMessage {
  type: RendererMessageType.SceneRenderedNotification;
  id: number;
}

export interface CanvasResizeMessage {
  type: RendererMessageType.CanvasResize;
  canvasWidth: number;
  canvasHeight: number;
  /** Buzzar: the screen's density; changes with browser zoom or a move to another monitor. */
  devicePixelRatio?: number;
}

export interface EnableMatrixMaterialMessage {
  type: RendererMessageType.EnableMatrixMaterial;
  enabled: boolean;
}

export type PhysicsDebugRenderTripleBuffer = ObjectTripleBuffer<{
  size: [Uint32ArrayConstructor, number];
  vertices: [Float32ArrayConstructor, number];
  colors: [Float32ArrayConstructor, number];
}>;

export interface TogglePhysicsDebugMessage {
  type: RendererMessageType.TogglePhysicsDebug;
}

export interface PhysicsEnableDebugRenderMessage {
  type: RendererMessageType.PhysicsEnableDebugRender;
  tripleBuffer: PhysicsDebugRenderTripleBuffer;
}

export interface PhysicsDisableDebugRenderMessage {
  type: RendererMessageType.PhysicsDisableDebugRender;
}

export interface SetNodeOptimizationsEnabledMessage {
  type: RendererMessageType.SetNodeOptimizationsEnabled;
  enabled: boolean;
}

export interface PrintRenderThreadStateMessage {
  type: RendererMessageType.PrintRenderThreadState;
}

export interface UICanvasPressMessage {
  type: RendererMessageType.UICanvasPress;
  uiCanvasEid: number;
  hitPoint: vec3;
}

export interface UICanvasFocusMessage {
  type: RendererMessageType.UICanvasFocus;
  uiCanvasEid: number;
  hitPoint: vec3;
}

export interface UIButtonPressMessage {
  type: RendererMessageType.UIButtonPress;
  buttonEid: number;
}
export interface UIButtonFocusMessage {
  type: RendererMessageType.UIButtonFocus;
  buttonEid: number;
}
export interface UIButtonUnfocusMessage {
  type: RendererMessageType.UIButtonUnfocus;
}

export interface EnterXRMessage {
  type: RendererMessageType.EnterXR;
  session: XRSession;
  mode: XRSessionMode;
}

export interface SetXRReferenceSpaceMessage {
  type: RendererMessageType.SetXRReferenceSpace;
  hand: XRHandedness;
}

export enum XRMode {
  None,
  ImmersiveVR,
  ImmersiveAR,
}

export const XRSessionModeToXRMode: { [key: string]: XRMode } = {
  "immersive-vr": XRMode.ImmersiveVR,
  "immersive-ar": XRMode.ImmersiveAR,
};

export const LOCAL_STORAGE_RENDER_QUALITY = "render-quality";
/** Buzzar (Third Room #204): your shadow setting (Settings → Graphics), whatever worlds set. */
export const LOCAL_STORAGE_SHADOW_QUALITY = "buzzar.shadowQuality";
export enum ShadowQualitySetting {
  /** Follow the render quality (shadows from Medium up). */
  Auto = "auto",
  Off = "off",
  Low = "low",
  Medium = "medium",
  High = "high",
}

/**
 * Buzzar (Third Room #204): a world's shadows, from its rules event (`shadows`). `sun`: its directional light casts
 * shadows and everything casts and receives them (for worlds lit by a real sun). `bakedSun`: for lightmapped worlds,
 * a shadow-only sun from this direction lets moving things (objects, avatars) cast shadows into the baked light.
 */
export interface WorldShadowSettings {
  sun: boolean;
  bakedSun?: {
    /** Degrees clockwise from north (-Z) the light comes from. */
    azimuth: number;
    /** Degrees above the horizon. */
    elevation: number;
    /** How dark its shadows are, 0–1. */
    strength: number;
  };
}

export interface SetWorldShadowsMessage {
  type: RendererMessageType.SetWorldShadows;
  shadows: WorldShadowSettings;
}

const clampNum = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/**
 * Reads (untrusted) world rules' `shadows`. Off unless the world turns them on. In the event, angles are whole degrees
 * and strength a whole percentage: Matrix events only allow whole numbers (homeservers reject 0.6 with a 400).
 */
export function parseWorldShadows(value: unknown): WorldShadowSettings {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const baked = raw.baked_sun as Record<string, unknown> | undefined;
  return {
    sun: raw.sun === true,
    bakedSun:
      typeof baked === "object" && baked !== null && baked.enabled === true
        ? {
            azimuth: clampNum(baked.azimuth, 0, 360, 135),
            elevation: clampNum(baked.elevation, 5, 90, 60),
            strength: clampNum(baked.strength, 0, 100, 60) / 100,
          }
        : undefined,
  };
}

/** Buzzar (Third Room #267): show a world in the Matrix style for a moment as it appears (off unless turned on). */
export const LOCAL_STORAGE_WORLD_REVEAL = "buzzar.worldReveal";

export function gpuTierToRenderQuality(gpuTier: number) {
  switch (gpuTier) {
    case 0:
      return RenderQuality.Low;
    case 1:
      return RenderQuality.Low;
    case 2:
      return RenderQuality.Medium;
    case 3:
      return RenderQuality.High;
    default:
      return RenderQuality.Medium;
  }
}

export enum RenderQualitySetting {
  Auto = "auto",
  Low = "low",
  Medium = "medium",
  High = "high",
  Ultra = "ultra",
}

export const RenderQualityOptions: { label: string; value: RenderQualitySetting }[] = [
  {
    label: "Low",
    value: RenderQualitySetting.Low,
  },
  {
    label: "Medium",
    value: RenderQualitySetting.Medium,
  },
  {
    label: "High",
    value: RenderQualitySetting.High,
  },
  {
    label: "Ultra",
    value: RenderQualitySetting.Ultra,
  },
];

export enum RenderQuality {
  Low,
  Medium,
  High,
  Ultra,
}

/**
 * Buzzar: the most screen pixels per CSS pixel each quality draws. It was always 1 (0.75 on Low), so high-density
 * screens (phones at 2.5-3×, many laptops at 2×) showed a stretched, blurry picture whatever the quality. Low keeps
 * 0.75; the others use the screen's density up to this cap. Dynamic resolution still lowers it if frames run long.
 */
const QualityMaxPixelRatio = {
  [RenderQuality.Low]: 0.75,
  [RenderQuality.Medium]: 1.5,
  [RenderQuality.High]: 2,
  [RenderQuality.Ultra]: 3,
};

export function basePixelRatioFor(quality: RenderQuality, devicePixelRatio: number) {
  if (quality === RenderQuality.Low) return QualityMaxPixelRatio[RenderQuality.Low];
  return Math.max(1, Math.min(devicePixelRatio || 1, QualityMaxPixelRatio[quality]));
}

export const RenderQualityToSetting = {
  [RenderQuality.Low]: RenderQualitySetting.Low,
  [RenderQuality.Medium]: RenderQualitySetting.Medium,
  [RenderQuality.High]: RenderQualitySetting.High,
  [RenderQuality.Ultra]: RenderQualitySetting.Ultra,
};

export enum RenderStats {
  fps,
  frameTime,
  frameDuration,
  frame,
  staleFrames,
  drawCalls,
  programs,
  geometries,
  textures,
  triangles,
  points,
  lines,
  /** Buzzar (Third Room #365): frames in the last second that showed new game state, and the longest frame (ms). */
  freshFps,
  worstFrame,
  /** Buzzar (Third Room #211): the dynamic resolution scale (1 = full). */
  resolutionScale,
}

export interface RenderStatsBuffer {
  buffer: SharedArrayBuffer;
  f32: Float32Array;
  u32: Uint32Array;
}

export const RenderStatNames = Object.keys(RenderStats).filter((v) => isNaN(+v));

export const XRCameraPoseSchema = defineObjectBufferSchema({
  matrix: [Float32Array, 16],
});
export const XRControllerPosesSchema = defineObjectBufferSchema({
  rayPose: [Float32Array, 16],
  gripPose: [Float32Array, 16],
});

// https://www.w3.org/TR/webxr-hand-input-1/#skeleton-joints
export const XRHandPosesSchema = defineObjectBufferSchema({
  matrices: [Float32Array, 25, 16],
  radii: [Float32Array, 25],
});

export type XRCameraPoseTripleBuffer = ObjectTripleBuffer<typeof XRCameraPoseSchema>;
export type XRControllerPosesTripleBuffer = ObjectTripleBuffer<typeof XRControllerPosesSchema>;
export type XRHandPosesTripleBuffer = ObjectTripleBuffer<typeof XRHandPosesSchema>;

export interface SharedXRInputSource {
  id: number;
  handedness: XRHandedness;
  layout: XRInputLayout;
  cameraPose: XRCameraPoseTripleBuffer;
  controllerPoses: XRControllerPosesTripleBuffer;
  handPoses?: XRHandPosesTripleBuffer;
}

export interface UpdateXRInputSourcesMessage {
  type: RendererMessageType.UpdateXRInputSources;
  added: SharedXRInputSource[];
  removed: number[];
}
