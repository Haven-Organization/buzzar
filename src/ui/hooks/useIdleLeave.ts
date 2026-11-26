/**
 * Buzzar: leaving a world you've walked away from. While you're in a world but away from it (the menu open, or
 * Buzzar hidden or minimised) for longer than your chosen time, you're asked if you're still there; a minute later
 * you leave, so the people there stop seeing an avatar nobody's behind (and your call membership ends). Coming back
 * to the world, or Stay, starts the count again. Settings → Worlds & Scripts → Leave Worlds When Away (Never turns
 * it off).
 */
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { overlayVisibilityAtom } from "../state/overlayVisibility";
import { useLocalStorage } from "./useLocalStorage";

export const IDLE_LEAVE_KEY = "buzzar.idleLeaveMinutes";
export const DEFAULT_IDLE_LEAVE_MINUTES = 15;
/** Minutes; 0 is Never. */
export const IDLE_LEAVE_CHOICES = [5, 10, 15, 30, 60, 120, 0];
/** How long the "Still there?" question waits before you leave. */
export const IDLE_LEAVE_WARNING_SECONDS = 60;

/** The stored setting, checked (untrusted): minutes away before you're asked, or 0 for never. */
export function parseIdleLeaveMinutes(value: unknown): number {
  return typeof value === "number" && IDLE_LEAVE_CHOICES.includes(value) ? value : DEFAULT_IDLE_LEAVE_MINUTES;
}

export function useIdleLeaveMinutes() {
  const [stored, setStored] = useLocalStorage<unknown>(IDLE_LEAVE_KEY, DEFAULT_IDLE_LEAVE_MINUTES);
  return [parseIdleLeaveMinutes(stored), (minutes: number) => setStored(minutes)] as const;
}

/**
 * Watches for being away from the world. Returns the seconds left before you leave while the question is showing
 * (undefined otherwise), and `stay` to answer it.
 */
export function useIdleLeave(onLeave: () => void) {
  const [minutes] = useIdleLeaveMinutes();
  const overlayVisible = useAtomValue(overlayVisibilityAtom);
  const [hidden, setHidden] = useState(() => document.visibilityState === "hidden");
  const awaySince = useRef<number>();
  const warnUntil = useRef<number>();
  const [secondsLeft, setSecondsLeft] = useState<number>();

  useEffect(() => {
    const update = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const away = overlayVisible || hidden;
  useEffect(() => {
    if (!away || minutes === 0) {
      awaySince.current = undefined;
      warnUntil.current = undefined;
      setSecondsLeft(undefined);
      return;
    }
    awaySince.current ??= Date.now();
    const tick = () => {
      const now = Date.now();
      if (warnUntil.current === undefined) {
        if (now - awaySince.current! < minutes * 60_000) return;
        warnUntil.current = now + IDLE_LEAVE_WARNING_SECONDS * 1000;
      }
      const left = Math.ceil((warnUntil.current - now) / 1000);
      if (left <= 0) {
        warnUntil.current = undefined;
        setSecondsLeft(undefined);
        onLeave();
        return;
      }
      setSecondsLeft(left);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [away, minutes, onLeave]);

  const stay = useCallback(() => {
    awaySince.current = Date.now();
    warnUntil.current = undefined;
    setSecondsLeft(undefined);
  }, []);

  return { secondsLeft, stay, minutes };
}
