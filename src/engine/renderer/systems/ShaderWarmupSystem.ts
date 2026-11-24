/**
 * Buzzar: shaders compile in the background instead of freezing the view. three.js compiles a material's shader the
 * first time something using it is drawn, and waits for the GPU driver to finish: over a second at a time while a
 * world or avatars loaded, so looking around stuttered. A mirror doubled it (its reflection is drawn with other
 * settings, so each material needs a second shader).
 *
 * Each frame this checks whether the scene has new meshes. If so, it starts compiling their shaders (for the main
 * view, and for reflections when a mirror is on) without waiting, and keeps those meshes hidden until the driver
 * reports their shaders ready (KHR_parallel_shader_compile). They appear a moment later; the view keeps running.
 * Where the browser can't report that, nothing is hidden and drawing waits for the compile as before.
 */
import { Light, Material, Mesh, NoToneMapping, Object3D, Scene, WebGLRenderer } from "three";

import { getModule, Thread } from "../../module/module.common";
import { RendererMessageType, RenderQuality, ShadersSettledMessage } from "../renderer.common";
import { RenderContext, RendererModule } from "../renderer.render";
import { Mirror } from "../Mirror";
import { MirrorState } from "../../resource/schema";

/** KHR_parallel_shader_compile's COMPLETION_STATUS_KHR. */
const COMPLETION_STATUS = 0x91b1;
/** Give up hiding a mesh after this long (ms): better to wait for its shader than never show it. */
const MAX_WAIT_MS = 10000;

let lastSceneEid = 0;
let lastMeshCount = -1;
let lastLights = "";
/** Frames in a row with nothing new to compile. */
let quietFrames = 0;
/** After this many quiet frames the scene counts as settled (lights and shadows switch on a few frames in). */
const SETTLED_FRAMES = 20;
/** How many programs the renderer had after the last warm-up check: more next frame means drawing compiled some. */
let programsSeen = 0;

type ProgramInfo = { name: string; cacheKey: string };

/**
 * Diagnostics: a shader the warm-up didn't predict was compiled while drawing (that stalls the frame). Logs how its
 * settings differ from the closest one already compiled, which says what the warm-up got wrong.
 */
function reportUnpredicted(programs: ProgramInfo[], from: number) {
  for (const program of programs.slice(from)) {
    const fields = program.cacheKey.split(",");
    let best: { diff: string[]; count: number } | undefined;
    for (const other of programs.slice(0, from)) {
      if (other.name !== program.name) continue;
      const otherFields = other.cacheKey.split(",");
      const diff: string[] = [];
      const n = Math.max(fields.length, otherFields.length);
      for (let i = 0; i < n; i++) {
        if (fields[i] !== otherFields[i])
          diff.push(`#${i}: ${otherFields[i]?.slice(0, 40)} → ${fields[i]?.slice(0, 40)}`);
      }
      if (!best || diff.length < best.count) best = { diff, count: diff.length };
    }
    console.info(
      `[shaders] compiled while drawing: ${program.name}`,
      best ? best.diff.slice(0, 8).join("; ") : `(no other ${program.name} yet) ${program.cacheKey.slice(0, 300)}`
    );
  }
}

/** Main-thread requests waiting for the scene to settle (the loading card stays up meanwhile). */
const settleRequests: number[] = [];

export function awaitShadersSettled(id: number) {
  settleRequests.push(id);
}
let parallel: boolean | undefined;
/** Meshes waiting for their shaders, and since when. */
const pending = new Map<Mesh, { programs: WebGLProgram[]; since: number; wasVisible: boolean }>();

/**
 * What decides which shaders the scene needs: its meshes, and its lights (a light added, or one starting to cast
 * shadows, as world shadows do, rebuilds every lit material's shader).
 */
function surveyScene(scene: Scene) {
  let meshes = 0;
  let mirror: Mirror | undefined;
  const lights: string[] = [];
  scene.traverse((object: Object3D) => {
    if ((object as Mesh).isMesh) meshes++;
    else if ((object as Light).isLight && object.visible) lights.push(object.type + (object.castShadow ? "+" : ""));
    if (object instanceof Mirror && object.state !== MirrorState.Off) mirror ??= object;
  });
  return { meshes, mirror, lights: `${lights.sort().join(",")}|${scene.environment?.uuid ?? ""}|${!!scene.fog}` };
}

type ProgramProperties = { currentProgram?: { program: WebGLProgram } };

/** The GL programs the renderer last compiled for a mesh's materials. */
function programsOf(renderer: WebGLRenderer, mesh: Mesh): WebGLProgram[] {
  const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
  const programs: WebGLProgram[] = [];
  for (const material of materials) {
    const program = (renderer.properties.get(material) as ProgramProperties).currentProgram?.program;
    if (program) programs.push(program);
  }
  return programs;
}

/** After compiling: note the meshes whose shaders aren't ready yet. */
function collectPending(renderer: WebGLRenderer, scene: Scene, now: number) {
  const gl = renderer.getContext();
  scene.traverse((object: Object3D) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const unfinished = programsOf(renderer, mesh).filter((p) => !gl.getProgramParameter(p, COMPLETION_STATUS));
    if (unfinished.length === 0) return;
    const entry = pending.get(mesh);
    if (entry) entry.programs.push(...unfinished);
    else pending.set(mesh, { programs: unfinished, since: now, wasVisible: mesh.visible });
  });
}

/** Before compiling: starts compiling whatever is new, for each way the scene is drawn. */
export function ShaderWarmupSystem(ctx: RenderContext) {
  const rendererModule = getModule(ctx, RendererModule);
  const activeScene = ctx.worldResource.environment?.publicScene;
  const camera = ctx.worldResource.activeCameraNode?.cameraObject;
  const { renderer, renderPipeline, scene } = rendererModule;
  if (!activeScene || !camera || renderer.xr.isPresenting) {
    quietFrames = 0;
    answerSettled(ctx, renderer.xr.isPresenting);
    return;
  }

  const programList = (renderer.info.programs ?? []) as unknown as ProgramInfo[];
  if (programList.length > programsSeen) reportUnpredicted(programList, programsSeen);
  programsSeen = programList.length;

  const { meshes, mirror, lights } = surveyScene(scene);
  if (activeScene.eid === lastSceneEid && meshes === lastMeshCount && lights === lastLights) {
    if (pending.size === 0) quietFrames++;
    answerSettled(ctx, false);
    return;
  }
  lastSceneEid = activeScene.eid;
  lastMeshCount = meshes;
  lastLights = lights;
  quietFrames = 0;

  const gl = renderer.getContext();
  parallel ??= !!gl.getExtension("KHR_parallel_shader_compile");

  const now = performance.now();
  const previousTarget = renderer.getRenderTarget();
  const programsBefore = renderer.info.programs?.length ?? 0;
  try {
    // The main view: High and Ultra draw it into the post-processing target, Low straight to the screen.
    renderer.setRenderTarget(
      rendererModule.quality === RenderQuality.Low ? null : renderPipeline.effectComposer.renderTarget1
    );
    renderer.compile(scene, camera);
    if (parallel) collectPending(renderer, scene, now);
    if (mirror) {
      // As Mirror.renderReflection draws it.
      const toneMapping = renderer.toneMapping;
      renderer.toneMapping = NoToneMapping;
      renderer.setRenderTarget(mirror.renderTarget);
      renderer.compile(scene, camera);
      renderer.toneMapping = toneMapping;
      if (parallel) collectPending(renderer, scene, now);
    }
  } finally {
    renderer.setRenderTarget(previousTarget);
  }
  programsSeen = renderer.info.programs?.length ?? 0;
  const added = programsSeen - programsBefore;
  if (added > 0) {
    console.info(`[shaders] compiling ${added} new shaders; ${pending.size} meshes wait for them`);
  }
}

/** Tells the main thread the scene's shaders are ready, once nothing new has needed compiling for a while. */
function answerSettled(ctx: RenderContext, now: boolean) {
  if (settleRequests.length === 0 || (!now && quietFrames < SETTLED_FRAMES)) return;
  for (const id of settleRequests.splice(0)) {
    ctx.sendMessage<ShadersSettledMessage>(Thread.Main, { type: RendererMessageType.ShadersSettled, id });
  }
}

/** Right before drawing: meshes whose shaders are still compiling stay hidden this frame. */
export function ShaderReadySystem(ctx: RenderContext) {
  if (pending.size === 0) return;
  const { renderer } = getModule(ctx, RendererModule);
  const gl = renderer.getContext();
  const now = performance.now();
  for (const [mesh, entry] of pending) {
    // Moving nodes have their visibility set every frame; static ones don't, so remember it to put it back.
    if (mesh.visible) entry.wasVisible = true;
    entry.programs = entry.programs.filter((p) => !gl.getProgramParameter(p, COMPLETION_STATUS));
    if (entry.programs.length === 0 || now - entry.since > MAX_WAIT_MS || !mesh.parent) {
      pending.delete(mesh);
      mesh.visible = entry.wasVisible;
      continue;
    }
    mesh.visible = false;
  }
}
