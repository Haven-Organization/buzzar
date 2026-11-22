/**
 * Buzzar (Third Room #156): on-screen controls for phones and tablets (see engine/input/touchControls.ts).
 *
 * - The joystick in the lower left moves you. Pushing it all the way runs, like a controller's stick.
 * - Dragging anywhere else on the world (not on a button or the joystick) turns the view. A flick keeps it turning
 *   for a moment after the finger lifts, slowing to a stop; touching the world again stops it.
 * - The buttons on the right jump, crouch, grab or use, and throw. Straightening what you hold and flying are in the
 *   HUD's More panel (TouchHudMenu).
 *
 * Touches on the world never become mouse clicks, so looking around doesn't grab things. The menu, chat, people and
 * the other on-screen buttons still work by tapping them.
 */
import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import classNames from "classnames";

import { PadButton } from "../../../../engine/input/gamepad.common";
import {
  onTouchControlsSetting,
  resetVirtualPad,
  touchControlsEnabled,
  virtualPad,
} from "../../../../engine/input/touchControls";
import "./TouchControls.css";

/** Joystick radius (CSS px): pushing this far is full tilt. */
const STICK_RADIUS = 56;
/** View turn per CSS px dragged, in mouse units (about 600 units turn 90°). */
const LOOK_PER_PX = 2;
/**
 * Momentum: after a flick the view keeps turning at the finger's speed and slows down, losing about two thirds of its
 * speed every COAST_TAU_MS. A finger that stopped before lifting (no recent movement) doesn't coast.
 */
const COAST_TAU_MS = 280;
const COAST_MIN_SPEED = 0.15; // px/ms: slower flicks just stop
const COAST_STOP_SPEED = 0.02; // px/ms
const COAST_RECENT_MS = 60;

/** Whether touch controls are on (the setting, or automatically on phones and tablets). */
export function useTouchControlsEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => touchControlsEnabled());
  useEffect(() => onTouchControlsSetting(() => setEnabled(touchControlsEnabled())), []);
  return enabled;
}

const BUTTONS: { button: number; label: string; className: string }[] = [
  { button: PadButton.A, label: "Jump", className: "TouchControls__button--jump" },
  { button: PadButton.L3, label: "Crouch", className: "TouchControls__button--crouch" },
  { button: PadButton.RB, label: "Use", className: "TouchControls__button--use" },
  { button: PadButton.X, label: "Throw", className: "TouchControls__button--throw" },
];

function TouchButton({ button, label, className }: { button: number; label: string; className: string }) {
  const [pressed, setPressed] = useState(false);
  const pointers = useRef(new Set<number>());
  const release = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      virtualPad.buttons.delete(button);
      setPressed(false);
    }
  };
  useEffect(() => () => void virtualPad.buttons.delete(button), [button]);
  return (
    <div
      role="button"
      aria-label={label}
      className={classNames("TouchControls__button", className, { "TouchControls__button--pressed": pressed })}
      onPointerDown={(e) => {
        // No focus, no text selection, no mouse emulation.
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        pointers.current.add(e.pointerId);
        virtualPad.buttons.set(button, 1);
        setPressed(true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </div>
  );
}

function TouchStick() {
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const pointer = useRef<number>();
  const centre = useRef({ x: 0, y: 0 });

  const move = (e: ReactPointerEvent) => {
    let dx = e.clientX - centre.current.x;
    let dy = e.clientY - centre.current.y;
    const length = Math.hypot(dx, dy);
    if (length > STICK_RADIUS) {
      dx = (dx / length) * STICK_RADIUS;
      dy = (dy / length) * STICK_RADIUS;
    }
    virtualPad.stick = [dx / STICK_RADIUS, dy / STICK_RADIUS];
    setKnob([dx, dy]);
  };
  const release = (e: ReactPointerEvent) => {
    if (e.pointerId !== pointer.current) return;
    pointer.current = undefined;
    virtualPad.stick = [0, 0];
    setKnob([0, 0]);
  };
  useEffect(() => () => void (virtualPad.stick = [0, 0]), []);

  return (
    <div
      className="TouchControls__stick"
      aria-label="Move"
      onPointerDown={(e) => {
        e.preventDefault();
        if (pointer.current !== undefined) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        pointer.current = e.pointerId;
        const rect = e.currentTarget.getBoundingClientRect();
        centre.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        move(e);
      }}
      onPointerMove={(e) => {
        if (e.pointerId === pointer.current) move(e);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="TouchControls__knob" style={{ transform: `translate(${knob[0]}px, ${knob[1]}px)` }} />
    </div>
  );
}

export function TouchControls({ canvas }: { canvas: HTMLCanvasElement }) {
  useEffect(() => {
    const previousTouchAction = canvas.style.touchAction;
    // The page mustn't scroll, zoom or go back while you play.
    canvas.style.touchAction = "none";
    // Each finger's last position and time, and its recent speed (px/ms).
    const looks = new Map<number, { x: number; y: number; t: number; vx: number; vy: number }>();
    let coast: { vx: number; vy: number; last: number; frame: number } | undefined;
    const stopCoasting = () => {
      if (coast) cancelAnimationFrame(coast.frame);
      coast = undefined;
    };
    const coastStep = (now: number) => {
      if (!coast) return;
      const dt = Math.min(50, now - coast.last);
      coast.last = now;
      virtualPad.look = [
        virtualPad.look[0] + coast.vx * dt * LOOK_PER_PX,
        virtualPad.look[1] + coast.vy * dt * LOOK_PER_PX,
      ];
      const decay = Math.exp(-dt / COAST_TAU_MS);
      coast.vx *= decay;
      coast.vy *= decay;
      if (Math.hypot(coast.vx, coast.vy) < COAST_STOP_SPEED) coast = undefined;
      else coast.frame = requestAnimationFrame(coastStep);
    };

    // Any touch on the world (the canvas: buttons, the joystick and the HUD sit above it) turns the view.
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      // No mouse events follow (they'd grab things).
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      // Touching the world again catches the view.
      stopCoasting();
      looks.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp, vx: 0, vy: 0 });
    };
    const onMove = (e: PointerEvent) => {
      const last = looks.get(e.pointerId);
      if (!last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      virtualPad.look = [virtualPad.look[0] + dx * LOOK_PER_PX, virtualPad.look[1] + dy * LOOK_PER_PX];
      const dt = e.timeStamp - last.t;
      // Recent speed, smoothed over the last few moves.
      const vx = dt > 0 ? last.vx * 0.4 + (dx / dt) * 0.6 : last.vx;
      const vy = dt > 0 ? last.vy * 0.4 + (dy / dt) * 0.6 : last.vy;
      looks.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp, vx, vy });
    };
    const onUp = (e: PointerEvent) => {
      const last = looks.get(e.pointerId);
      looks.delete(e.pointerId);
      if (!last || looks.size > 0 || e.type === "pointercancel") return;
      if (e.timeStamp - last.t > COAST_RECENT_MS) return;
      if (Math.hypot(last.vx, last.vy) < COAST_MIN_SPEED) return;
      stopCoasting();
      coast = { vx: last.vx, vy: last.vy, last: performance.now(), frame: 0 };
      coast.frame = requestAnimationFrame(coastStep);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.style.touchAction = previousTouchAction;
      stopCoasting();
      resetVirtualPad();
    };
  }, [canvas]);

  return (
    <div className="TouchControls">
      <TouchStick />
      <div className="TouchControls__buttons">
        {BUTTONS.map((b) => (
          <TouchButton key={b.button} {...b} />
        ))}
      </div>
    </div>
  );
}
