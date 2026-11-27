/**
 * Buzzar: a 3D view of an avatar or Item on its details page: drag to turn it round, scroll (or pinch) to zoom.
 * Poses avatars the way their preview pictures do (utils/avatarPreview). Renders only while something changes.
 */
import { useEffect, useRef, useState } from "react";
import {
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  sRGBEncoding,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

import { Dots } from "../../../atoms/loading/Dots";
import { Text } from "../../../atoms/text/Text";
import { disposeObject, loadPreviewModel } from "../../../utils/avatarPreview";
import { GLTFRoot } from "../../../../engine/gltf/GLTF";
import "./ModelViewer.css";

export interface LoadedModel {
  json: GLTFRoot;
  /** File size in bytes. */
  bytes: number;
}

export function ModelViewer({
  url,
  kind,
  onLoaded,
}: {
  /** An http(s) URL or app path to the .glb / .vrm. */
  url: string;
  kind: "avatar" | "item";
  onLoaded?: (model: LoadedModel) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | string>("loading");
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;

  useEffect(() => {
    const container = box.current;
    if (!container) return;
    let disposed = false;
    let cleanup = () => {};
    setState("loading");
    (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn't download the file (${res.status})`);
      const buffer = await res.arrayBuffer();
      if (disposed) return;
      const model = await loadPreviewModel(buffer);
      if (disposed) return disposeObject(model.root);
      loaded.current?.({ json: model.json, bytes: buffer.byteLength });

      const scene = new Scene();
      scene.add(model.root);
      const facing = new Vector3(0.35, 0.15, 1).normalize();
      if (model.mapping?.facesNegativeZ) facing.z = -facing.z;
      const radius = Math.max(model.size.length() / 2, 0.05);
      const camera = new PerspectiveCamera(30, 1, radius / 100, radius * 100);
      camera.position.copy(model.center).addScaledVector(facing, (radius * 1.15) / Math.sin((15 * Math.PI) / 180));
      scene.add(new HemisphereLight(0xffffff, 0x444455, 1.6));
      const key = new DirectionalLight(0xffffff, 1.4);
      key.position.copy(model.center).add(new Vector3(1.5, 2.5, 3).multiplyScalar(radius));
      scene.add(key);

      const renderer = new WebGLRenderer({ antialias: true, alpha: true, multiviewStereo: false });
      renderer.outputEncoding = sRGBEncoding;
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(model.center);
      controls.enableDamping = true;
      controls.minDistance = radius * 0.3;
      controls.maxDistance = radius * 12;
      if (kind === "avatar") controls.enablePan = false;

      let frame = 0;
      const render = () => {
        frame = 0;
        if (controls.update()) frame = requestAnimationFrame(render); // still easing (damping)
        renderer.render(scene, camera);
      };
      const requestRender = () => {
        if (!frame) frame = requestAnimationFrame(render);
      };
      controls.addEventListener("change", requestRender);
      const resize = () => {
        const { clientWidth: w, clientHeight: h } = container;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        requestRender();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
      setState("ready");

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        disposeObject(scene);
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
    })().catch((e) => {
      if (!disposed) setState(e instanceof Error ? e.message : String(e));
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [url, kind]);

  return (
    <div className="ModelViewer" ref={box}>
      {state === "loading" && (
        <div className="ModelViewer__status flex flex-column items-center justify-center gap-xs">
          <Dots size="md" />
          <Text variant="b3" color="surface-low">
            Loading the model…
          </Text>
        </div>
      )}
      {state !== "loading" && state !== "ready" && (
        <div className="ModelViewer__status flex items-center justify-center">
          <Text variant="b3" color="danger">
            {state}
          </Text>
        </div>
      )}
      {state === "ready" && (
        <Text className="ModelViewer__hint" variant="b3" color="surface-low">
          Drag to turn · scroll to zoom
        </Text>
      )}
    </div>
  );
}
