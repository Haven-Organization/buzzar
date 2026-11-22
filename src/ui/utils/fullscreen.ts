/**
 * Buzzar: fullscreen (the HUD's fullscreen button and the command palette). Browsers only allow it in response to a tap,
 * click or key press. Safari on iPhone allows it only for videos: there, adding Buzzar to the home screen is the way to
 * get rid of the browser bars (see public/manifest.json).
 */
import { useEffect, useState } from "react";

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function fullscreenSupported(): boolean {
  const doc = document as WebkitDocument;
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  const doc = document as WebkitDocument;
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

export async function toggleFullscreen(): Promise<void> {
  const doc = document as WebkitDocument;
  try {
    if (isFullscreen()) {
      await (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.());
      return;
    }
    const root = document.documentElement as WebkitElement;
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: "hide" });
    else await root.webkitRequestFullscreen?.();
  } catch (error) {
    console.warn("Fullscreen wasn't allowed", error);
  }
}

/** Whether the page is fullscreen now, updated as it changes (the button, Escape, the browser's own controls). */
export function useFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(isFullscreen);
  useEffect(() => {
    const update = () => setFullscreen(isFullscreen());
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, []);
  return fullscreen;
}
