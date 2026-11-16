import { registerThirdroomGlobalFn } from "../utils/registerThirdroomGlobal";
import { MainContext } from "../MainThread";
import { defineModule, getModule, registerMessageHandler, Thread } from "../module/module.common";
import { codeToKeyCode } from "./KeyCodes";
import { getStats } from "../stats/stats.main";
import { PlayerModule } from "../player/Player.main";
import { InitializeInputStateMessage, InputComponentId, InputMessageType, InputSourceId } from "./input.common";
import { enqueueInputRingBuffer, InputRingBuffer } from "../common/InputRingBuffer";
import { EditorModule } from "../editor/editor.main";

/*********
 * Types *
 ********/

export interface MainInputModule {
  nextStackId: number;
  disableInputStack: number[];
  inputRingBuffer: InputRingBuffer;
}

/******************
 * Initialization *
 *****************/

export const InputModule = defineModule<MainContext, MainInputModule>({
  name: "input",
  create({ inputRingBuffer }, { sendMessage }) {
    sendMessage<InitializeInputStateMessage>(Thread.Game, InputMessageType.InitializeInputState, {
      inputRingBuffer,
    });

    return {
      nextStackId: 0,
      disableInputStack: [],
      inputRingBuffer,
    };
  },
  init(ctx) {
    const editorModule = getModule(ctx, EditorModule);
    const inputModule = getModule(ctx, InputModule);
    const { inputRingBuffer: irb } = inputModule;
    const camRigModule = getModule(ctx, PlayerModule);
    const { canvas } = ctx;

    const lastKeyMap: { [key: string]: boolean } = {};
    const debugCounts: {
      keyDown: number;
      keyEnqueued: number;
      dropped: { disabled: number; notLocked: number };
      droppedSpikes?: number;
    } = { keyDown: 0, keyEnqueued: 0, dropped: { disabled: 0, notLocked: 0 } };

    registerThirdroomGlobalFn("playerDebug", () =>
      ctx.sendMessage(Thread.Game, { type: "software.haven.debug.player" })
    );

    // Buzzar debug: `thirdroom.sit(0)` sits on the world's first seat (HAVEN_seat), `thirdroom.sit()` stands up.
    registerThirdroomGlobalFn("sit", (seat?: number) =>
      ctx.sendMessage(Thread.Game, { type: "software.haven.debug.sit", seat: seat ?? -1 })
    );

    // Buzzar debug: `thirdroom.blink(1)` / `(0)` hold every avatar's eyes closed / open; `()` resumes blinking.
    registerThirdroomGlobalFn("blink", (closed?: number) =>
      ctx.sendMessage(Thread.Game, { type: "software.haven.debug.blink", closed: closed ?? -1 })
    );

    // Buzzar debug: movement/focus tracing. Enable with `?debugMovement=1` in the URL (persists; `=0` turns it
    // off). Logs raw keyboard/focus/pointer-lock events plus input + player state every 2 s to the console and,
    // under `vite dev`, to `.buzzar-debug.log` in the project (see src/vite/debug-log.ts).
    let debugMovement = false;
    try {
      const param = new URLSearchParams(location.search).get("debugMovement");
      if (param === "1") localStorage.setItem("software.haven.debug.movement", "1");
      if (param === "0") localStorage.removeItem("software.haven.debug.movement");
      debugMovement = localStorage.getItem("software.haven.debug.movement") === "1";
    } catch {
      // storage unavailable
    }
    const debugDisposers: (() => void)[] = [];
    if (debugMovement) {
      const buffer: string[] = [];
      const t0 = Date.now();
      const log = (kind: string, data: object) => {
        const line = JSON.stringify({ t: Date.now() - t0, kind, ...data });
        console.info(`[movement-debug] ${line}`);
        buffer.push(line);
      };
      const describe = (target: EventTarget | null) =>
        target instanceof Element
          ? `${target.tagName}${target.id ? "#" + target.id : ""}${
              target.className ? "." + String(target.className).split(" ")[0] : ""
            }`
          : target === window
          ? "window"
          : target === document
          ? "document"
          : String(target);
      const onAny = (event: Event) => {
        const e = event as KeyboardEvent & MouseEvent;
        log(event.type, {
          target: describe(event.target),
          code: e.code,
          repeat: e.repeat,
          button: e.button,
          active: describe(document.activeElement),
          locked: document.pointerLockElement === canvas,
          hasFocus: document.hasFocus(),
        });
      };
      const types = [
        "keydown",
        "keyup",
        "focus",
        "blur",
        "focusin",
        "focusout",
        "mousedown",
        "pointerlockchange",
        "pointerlockerror",
        "visibilitychange",
      ];
      for (const type of types) {
        const target = type.startsWith("pointerlock") || type === "visibilitychange" ? document : window;
        target.addEventListener(type, onAny, true);
        debugDisposers.push(() => target.removeEventListener(type, onAny, true));
      }
      log("start", { url: location.href, userAgent: navigator.userAgent });

      const unregister = registerMessageHandler(ctx, "software.haven.debug.player.result", (_, message: any) =>
        log("player", message.data)
      );
      debugDisposers.push(unregister);

      const timer = window.setInterval(() => {
        log("state", {
          locked: document.pointerLockElement === canvas,
          active: describe(document.activeElement),
          hasFocus: document.hasFocus(),
          visibility: document.visibilityState,
          stack: inputModule.disableInputStack.length,
          heldKeys: Object.keys(lastKeyMap).filter((k) => lastKeyMap[k]),
          counts: debugCounts,
        });
        try {
          const stats = getStats(ctx);
          log("perf", {
            fps: stats.fps,
            frameMs: stats.frameDuration,
            gameMs: stats.gameDuration,
            gameTime: stats.gameTime,
            staleFrames: stats.staleFrames,
            drawCalls: stats.drawCalls,
            triangles: stats.triangles,
            textures: stats.textures,
          });
        } catch {
          // stats not ready yet
        }
        ctx.sendMessage(Thread.Game, { type: "software.haven.debug.player" });
        if (buffer.length) {
          const body = buffer.splice(0).join("\n");
          fetch("/__buzzar/debug-log", { method: "POST", body, keepalive: true }).catch(() => {});
        }
      }, 2000);
      debugDisposers.push(() => window.clearInterval(timer));
    }

    // Buzzar debug helper: `thirdroom.inputState()` in the console.
    registerThirdroomGlobalFn("inputState", () => ({
      disableInputStack: [...inputModule.disableInputStack],
      pointerLocked: document.pointerLockElement === canvas,
      orbiting: camRigModule.orbiting,
      activeElement: document.activeElement?.tagName,
      heldKeys: Object.keys(lastKeyMap).filter((k) => lastKeyMap[k]),
      counts: debugCounts,
    }));

    function enqueue(
      inputSourceId: number,
      componentId: number,
      button: number,
      xAxis: number,
      yAxis: number,
      zAxis: number,
      wAxis: number,
      state: number
    ) {
      // Buzzar: always deliver releases. Dropping a key-up / mouse-up while the pointer wasn't locked (loading,
      // overlay, before the first click) left the game thinking the key was still held — e.g. a phantom "S"
      // cancelling W — until a window blur reset everything. A release can never cause unwanted input.
      const isRelease =
        (inputSourceId === InputSourceId.Keyboard && componentId === InputComponentId.KeyboardButton && button === 0) ||
        (inputSourceId === InputSourceId.Mouse && componentId === InputComponentId.MouseButtons && state === 0);
      if (isRelease) {
        forceEnqueue(inputSourceId, componentId, button, xAxis, yAxis, zAxis, wAxis, state);
        return;
      }

      if (inputModule.disableInputStack.length > 0) {
        if (inputSourceId === InputSourceId.Keyboard) debugCounts.dropped.disabled++;
        return;
      }

      const orbiting = camRigModule.orbiting;
      const pointerLocked = document.pointerLockElement !== null;

      // Allow editor specific inputs without pointerLocked
      if (
        editorModule.editorLoaded &&
        ((inputSourceId === InputSourceId.Mouse && componentId === InputComponentId.MouseButtons) ||
          state === codeToKeyCode("KeyF"))
      ) {
        enqueueInputRingBuffer(irb, inputSourceId, componentId, button, xAxis, yAxis, zAxis, wAxis, state);
      }

      if (!pointerLocked && !orbiting) {
        if (inputSourceId === InputSourceId.Keyboard) debugCounts.dropped.notLocked++;
        return;
      }
      if (inputSourceId === InputSourceId.Keyboard) debugCounts.keyEnqueued++;

      if (!enqueueInputRingBuffer(irb, inputSourceId, componentId, button, xAxis, yAxis, zAxis, wAxis, state)) {
        console.warn("input ring buffer full");
      }
    }

    function forceEnqueue(
      inputSourceId: number,
      componentId: number,
      button: number,
      xAxis: number,
      yAxis: number,
      zAxis: number,
      wAxis: number,
      state: number
    ) {
      if (!enqueueInputRingBuffer(irb, inputSourceId, componentId, button, xAxis, yAxis, zAxis, wAxis, state)) {
        console.warn("input ring buffer full");
      }
    }

    function resetAllInputs() {
      for (const code in lastKeyMap) {
        if (!lastKeyMap[code]) continue;
        forceEnqueue(InputSourceId.Keyboard, InputComponentId.KeyboardButton, 0, 0, 0, 0, 0, codeToKeyCode(code));
        lastKeyMap[code] = false;
      }
      forceEnqueue(InputSourceId.Mouse, InputComponentId.MouseMovement, 0, 0, 0, 0, 0, 0);
      forceEnqueue(InputSourceId.Mouse, InputComponentId.MouseButtons, 0, 0, 0, 0, 0, 0);
      forceEnqueue(InputSourceId.Mouse, InputComponentId.MouseScroll, 0, 0, 0, 0, 0, 0);
    }

    function onMouseDown({ buttons }: MouseEvent) {
      enqueue(InputSourceId.Mouse, InputComponentId.MouseButtons, 0, 0, 0, 0, 0, buttons);
    }

    function onMouseUp({ buttons }: MouseEvent) {
      enqueue(InputSourceId.Mouse, InputComponentId.MouseButtons, 0, 0, 0, 0, 0, buttons);
    }

    function onKeyDown({ code, ctrlKey, altKey, metaKey }: KeyboardEvent) {
      debugCounts.keyDown++;
      // Buzzar: browser/OS shortcuts (Ctrl+Shift+B toggles Brave's bookmarks bar, Ctrl+T, Alt+Tab…) must not also
      // fire game actions; Ctrl+Shift+B was switching fly mode on. No game binding uses Ctrl/Alt/Meta. Releases
      // are still always delivered (onKeyUp), so nothing can get stuck held.
      if (ctrlKey || altKey || metaKey) return;
      if (lastKeyMap[code]) return;
      lastKeyMap[code] = true;

      enqueue(InputSourceId.Keyboard, InputComponentId.KeyboardButton, 1, 0, 0, 0, 0, codeToKeyCode(code));
    }

    function onKeyUp({ code }: KeyboardEvent) {
      lastKeyMap[code] = false;
      enqueue(InputSourceId.Keyboard, InputComponentId.KeyboardButton, 0, 0, 0, 0, 0, codeToKeyCode(code));
    }

    // Buzzar: Chromium on Linux/X11 keeps the locked cursor centred by warping it; while a mouse button is held those
    // warps leak through as single fake movements of ~400-550 px in the opposite direction, which snapped the camera
    // back. Drop a lone movement that is both large and far bigger than the recent ones. Real fast flicks build up
    // over several events, so the running average follows them.
    const SPIKE_MIN = 300;
    let recentMovement = 0;

    function onMouseMove({ movementX, movementY, clientX, clientY }: MouseEvent) {
      const size = Math.max(Math.abs(movementX), Math.abs(movementY));
      if (document.pointerLockElement === canvas && size > SPIKE_MIN && size > 3 * recentMovement + 60) {
        debugCounts.droppedSpikes = (debugCounts.droppedSpikes ?? 0) + 1;
        return;
      }
      recentMovement = recentMovement * 0.6 + size * 0.4;
      enqueue(InputSourceId.Mouse, InputComponentId.MouseMovement, 0, movementX, movementY, clientX, clientY, 0);
    }

    function onWheel({ deltaX, deltaY }: WheelEvent) {
      enqueue(InputSourceId.Mouse, InputComponentId.MouseScroll, 0, deltaX, deltaY, 0, 0, 0);
    }

    function onBlur() {
      resetAllInputs();
    }

    function onMouseLeave() {
      resetAllInputs();
    }

    let wasLocked = document.pointerLockElement === canvas;

    function onPointerLockChange() {
      const locked = document.pointerLockElement === canvas;
      const gained = locked && !wasLocked;
      wasLocked = locked;
      if (!locked) {
        resetAllInputs();
      } else if (gained) {
        // Buzzar: on gaining the pointer, start from a clean slate: release every key the game might think is held
        // (anything stuck from before — a dropped key-up, or a key-up that never reached the page because of
        // Alt-Tab or a navigation). Keys physically held now just need pressing again.
        for (const code in lastKeyMap) {
          lastKeyMap[code] = false;
          forceEnqueue(InputSourceId.Keyboard, InputComponentId.KeyboardButton, 0, 0, 0, 0, 0, codeToKeyCode(code));
        }
        forceEnqueue(InputSourceId.Mouse, InputComponentId.MouseButtons, 0, 0, 0, 0, 0, 0);
      }
    }

    // Buzzar: no context menu while playing (pointer locked). A right-click is a game input; a menu would steal
    // focus and release held keys (e.g. stop a sprint). The desktop app's own menu is skipped too.
    function onContextMenu(e: MouseEvent) {
      if (document.pointerLockElement === canvas) e.preventDefault();
    }

    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseLeave);
    canvas.addEventListener("wheel", onWheel);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("blur", onBlur);

    document.addEventListener("pointerlockchange", onPointerLockChange);

    if (debugMovement) {
      console.info("[movement-debug] input listeners attached");
    }

    return () => {
      if (debugMovement) {
        // A dispose without a fresh init would leave the page deaf to the keyboard; make that visible.
        fetch("/__buzzar/debug-log", {
          method: "POST",
          body: JSON.stringify({ t: Date.now(), kind: "input-module-disposed" }),
          keepalive: true,
        }).catch(() => {});
      }
      for (const dispose of debugDisposers) dispose();
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      canvas.removeEventListener("wheel", onWheel);

      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("blur", onBlur);

      document.removeEventListener("pointerlockchange", onPointerLockChange);
    };
  },
});
