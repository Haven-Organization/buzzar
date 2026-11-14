/**
 * Buzzar planar mirror. Adapted from three.js examples/jsm/objects/Reflector.js (MIT, r148).
 *
 * Differences from the stock Reflector:
 * - Quality modes: High reflects the world + avatars; Low reflects only avatars (Layer.Avatar) over a
 *   flat background, so world geometry isn't rendered into the reflection at all.
 * - Off costs nothing: the mesh is hidden, so onBeforeRender never runs.
 * - Render-target size follows the viewport (per eye in XR) × resolutionScale.
 * - No recursion: other mirrors are hidden while a reflection renders.
 * - Distance culling: beyond maxDistance the mirror shows a flat colour instead of rendering.
 * - Output goes through tone mapping / encoding so the reflection matches the scene.
 *
 * In WebXR, three renders each object once per eye camera and calls onBeforeRender before each draw,
 * so each eye renders its own reflection with the correct parallax.
 */
import {
  Color,
  HalfFloatType,
  LinearEncoding,
  Matrix4,
  Mesh,
  NoToneMapping,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from "three";

import { addLayer, Layer } from "../common/Layers";
import { MirrorState } from "../resource/schema";
import { updateTransformFromNode } from "./node";
import { RenderContext } from "./renderer.render";
import { RenderMirror, RenderNode } from "./RenderResources";

/** Longest edge of the reflection render target. Full-resolution 4K reflections were a big frame-time cost. */
const MAX_TEXTURE_SIZE = 1024;
const HIGH_SAMPLES = 2;
const MIN_TEXTURE_SIZE = 64;
const CLIP_BIAS = 0.003;

export const MIRROR_HIGH_LAYERS = addLayer(addLayer(addLayer(0, Layer.Default), Layer.Avatar), Layer.Lights);
export const MIRROR_LOW_LAYERS = addLayer(addLayer(0, Layer.Avatar), Layer.Lights);

const MirrorShader = {
  uniforms: {
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    mirrorActive: { value: 1 },
    inactiveColor: { value: new Color(0x202024) },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float mirrorActive;
    uniform vec3 inactiveColor;
    varying vec4 vUv;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec3 reflected = texture2DProj( tDiffuse, vUv ).rgb;
      gl_FragColor = vec4( mix( inactiveColor, reflected, mirrorActive ), 1.0 );
      #include <tonemapping_fragment>
      #include <encodings_fragment>
    }`,
};

const activeMirrors = new Set<Mirror>();
let renderingReflection = false;

const _reflectorPlane = new Plane();
const _normal = new Vector3();
const _reflectorWorldPosition = new Vector3();
const _cameraWorldPosition = new Vector3();
const _rotationMatrix = new Matrix4();
const _lookAtPosition = new Vector3();
const _clipPlane = new Vector4();
const _view = new Vector3();
const _target = new Vector3();
const _q = new Vector4();
const _size = new Vector2();
const _scale = new Vector3();
const _position = new Vector3();
const _quaternion = new Quaternion();
const _backgroundColor = new Color();

export class Mirror extends Mesh<PlaneGeometry, ShaderMaterial> {
  readonly virtualCamera = new PerspectiveCamera();
  readonly renderTarget: WebGLRenderTarget;
  private readonly textureMatrix = new Matrix4();
  private width = 0;
  private height = 0;
  state: MirrorState = MirrorState.Off;
  resolutionScale = 1;
  maxDistance = 30;

  constructor(public resource: RenderMirror) {
    super(new PlaneGeometry(1, 1));

    this.renderTarget = new WebGLRenderTarget(MIN_TEXTURE_SIZE, MIN_TEXTURE_SIZE, {
      samples: HIGH_SAMPLES,
      type: HalfFloatType,
    });

    this.material = new ShaderMaterial({
      name: "MirrorMaterial",
      uniforms: {
        tDiffuse: { value: this.renderTarget.texture },
        textureMatrix: { value: this.textureMatrix },
        mirrorActive: { value: 1 },
        inactiveColor: { value: MirrorShader.uniforms.inactiveColor.value.clone() },
      },
      vertexShader: MirrorShader.vertexShader,
      fragmentShader: MirrorShader.fragmentShader,
    });

    this.frustumCulled = true;
    this.onBeforeRender = this.renderReflection;
  }

  update(ctx: RenderContext, node: RenderNode) {
    const { width, height, state, resolutionScale, maxDistance } = this.resource;

    if (width !== this.width || height !== this.height) {
      this.geometry.dispose();
      this.geometry = new PlaneGeometry(Math.max(width, 0.01), Math.max(height, 0.01));
      this.width = width;
      this.height = height;
    }

    updateTransformFromNode(ctx, node, this);

    this.state = state;
    this.resolutionScale = resolutionScale > 0 ? resolutionScale : 1;
    this.maxDistance = maxDistance > 0 ? maxDistance : Infinity;
    this.visible = this.visible && state !== MirrorState.Off;

    if (this.visible) {
      activeMirrors.add(this);
    } else {
      activeMirrors.delete(this);
    }
  }

  private renderReflection: Mesh["onBeforeRender"] = (renderer, scene, camera) => {
    // Reflections never contain other reflections.
    if (renderingReflection || this.state === MirrorState.Off) return;

    const uniforms = this.material.uniforms;

    _reflectorWorldPosition.setFromMatrixPosition(this.matrixWorld);
    _cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
    _rotationMatrix.extractRotation(this.matrixWorld);

    _normal.set(0, 0, 1).applyMatrix4(_rotationMatrix);
    _view.subVectors(_reflectorWorldPosition, _cameraWorldPosition);

    // Facing away: nothing to reflect.
    if (_view.dot(_normal) > 0) return;

    // Too far away: show a flat colour instead of paying for a render.
    this.matrixWorld.decompose(_position, _quaternion, _scale);
    const halfDiagonal = 0.5 * Math.hypot(this.width * _scale.x, this.height * _scale.y);
    if (_view.length() - halfDiagonal > this.maxDistance) {
      uniforms.mirrorActive.value = 0;
      return;
    }
    uniforms.mirrorActive.value = 1;

    // Size the render target to the current viewport (the eye's viewport in XR).
    const viewport = (camera as PerspectiveCamera & { viewport?: Vector4 }).viewport;
    if (viewport) {
      _size.set(viewport.z, viewport.w);
    } else {
      renderer.getDrawingBufferSize(_size);
    }
    // Keep the viewport's aspect ratio but cap the longest edge, so cost doesn't scale with 4K/HiDPI screens.
    let scale = this.resolutionScale * (this.state === MirrorState.Low ? 0.75 : 1);
    scale = Math.min(scale, MAX_TEXTURE_SIZE / Math.max(_size.x, _size.y, 1));
    const texWidth = Math.max(Math.round(_size.x * scale), MIN_TEXTURE_SIZE);
    const texHeight = Math.max(Math.round(_size.y * scale), MIN_TEXTURE_SIZE);
    if (this.renderTarget.width !== texWidth || this.renderTarget.height !== texHeight) {
      this.renderTarget.setSize(texWidth, texHeight);
    }
    // Avatars-only reflections don't need multisampling.
    const samples = this.state === MirrorState.Low ? 0 : HIGH_SAMPLES;
    if (this.renderTarget.samples !== samples) {
      this.renderTarget.samples = samples;
      this.renderTarget.dispose(); // re-allocates with the new sample count on next use
    }

    const virtualCamera = this.virtualCamera;

    _view.reflect(_normal).negate();
    _view.add(_reflectorWorldPosition);

    _rotationMatrix.extractRotation(camera.matrixWorld);

    _lookAtPosition.set(0, 0, -1);
    _lookAtPosition.applyMatrix4(_rotationMatrix);
    _lookAtPosition.add(_cameraWorldPosition);

    _target.subVectors(_reflectorWorldPosition, _lookAtPosition);
    _target.reflect(_normal).negate();
    _target.add(_reflectorWorldPosition);

    virtualCamera.position.copy(_view);
    virtualCamera.up.set(0, 1, 0);
    virtualCamera.up.applyMatrix4(_rotationMatrix);
    virtualCamera.up.reflect(_normal);
    virtualCamera.lookAt(_target);

    virtualCamera.far = (camera as PerspectiveCamera).far; // Used in WebGLBackground
    virtualCamera.updateMatrixWorld();
    virtualCamera.projectionMatrix.copy(camera.projectionMatrix);
    virtualCamera.layers.mask = this.state === MirrorState.Low ? MIRROR_LOW_LAYERS : MIRROR_HIGH_LAYERS;

    // Update the texture matrix
    this.textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0);
    this.textureMatrix.multiply(virtualCamera.projectionMatrix);
    this.textureMatrix.multiply(virtualCamera.matrixWorldInverse);
    this.textureMatrix.multiply(this.matrixWorld);

    // Oblique near-plane clipping: http://www.terathon.com/lengyel/Lengyel-Oblique.pdf
    _reflectorPlane.setFromNormalAndCoplanarPoint(_normal, _reflectorWorldPosition);
    _reflectorPlane.applyMatrix4(virtualCamera.matrixWorldInverse);

    _clipPlane.set(
      _reflectorPlane.normal.x,
      _reflectorPlane.normal.y,
      _reflectorPlane.normal.z,
      _reflectorPlane.constant
    );

    const projectionMatrix = virtualCamera.projectionMatrix;

    _q.x = (Math.sign(_clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
    _q.y = (Math.sign(_clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
    _q.z = -1.0;
    _q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];

    _clipPlane.multiplyScalar(2.0 / _clipPlane.dot(_q));

    projectionMatrix.elements[2] = _clipPlane.x;
    projectionMatrix.elements[6] = _clipPlane.y;
    projectionMatrix.elements[10] = _clipPlane.z + 1.0 - CLIP_BIAS;
    projectionMatrix.elements[14] = _clipPlane.w;

    // Render
    const currentRenderTarget = renderer.getRenderTarget();
    const currentXrEnabled = renderer.xr.enabled;
    const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const currentOutputEncoding = renderer.outputEncoding;
    const currentToneMapping = renderer.toneMapping;
    const currentBackground = scene.background;

    renderingReflection = true;
    for (const mirror of activeMirrors) mirror.visible = false;

    if (this.state === MirrorState.Low) {
      const [r, g, b] = this.resource.backgroundColor;
      scene.background = _backgroundColor.setRGB(r, g, b);
    }

    renderer.xr.enabled = false; // Avoid camera modification
    renderer.shadowMap.autoUpdate = false; // Avoid re-computing shadows
    renderer.outputEncoding = LinearEncoding;
    renderer.toneMapping = NoToneMapping;

    renderer.setRenderTarget(this.renderTarget);
    renderer.state.buffers.depth.setMask(true); // make sure the depth buffer is writable so it can be properly cleared
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, virtualCamera);

    renderer.xr.enabled = currentXrEnabled;
    renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
    renderer.outputEncoding = currentOutputEncoding;
    renderer.toneMapping = currentToneMapping;
    renderer.setRenderTarget(currentRenderTarget);
    scene.background = currentBackground;

    for (const mirror of activeMirrors) mirror.visible = true;
    renderingReflection = false;

    // Restore viewport
    if (viewport !== undefined) {
      renderer.state.viewport(viewport);
    }
  };

  dispose() {
    activeMirrors.delete(this);
    this.renderTarget.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
