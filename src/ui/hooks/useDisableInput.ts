import { useEffect } from "react";

import { InputModule } from "../../engine/input/input.main";
import { getModule } from "../../engine/module/module.common";
import { PlayerModule } from "../../engine/player/Player.main";
import { useMainThreadContext } from "./useMainThread";

export function useDisableInput(state = true) {
  const mainThread = useMainThreadContext();

  useEffect(() => {
    if (!state) {
      return;
    }

    const inputModule = getModule(mainThread, InputModule);
    const cameraRigModule = getModule(mainThread, PlayerModule);

    if (
      inputModule.disableInputStack.length === 0 &&
      !cameraRigModule.orbiting &&
      document.pointerLockElement === mainThread.canvas
    ) {
      document.exitPointerLock();
    }

    const stackId = inputModule.nextStackId++;

    inputModule.disableInputStack.push(stackId);

    // Buzzar: keep the mouse free for as long as input is disabled. Something else can capture it after we
    // released it above (a world finishing loading behind a dialog, which the desktop app allows without a click),
    // leaving a dialog on screen that can't be clicked.
    const releasePointer = () => {
      if (document.pointerLockElement === mainThread.canvas && !cameraRigModule.orbiting) document.exitPointerLock();
    };
    document.addEventListener("pointerlockchange", releasePointer);

    return () => {
      document.removeEventListener("pointerlockchange", releasePointer);
      const index = inputModule.disableInputStack.indexOf(stackId);

      if (index !== -1) {
        inputModule.disableInputStack.splice(index, 1);
      }

      // Buzzar: don't re-capture the pointer from code here. This runs after clicking UI buttons (overlay, world
      // selection), and in Chromium a pointer lock taken that way left the page receiving no keyboard events
      // until the window was refocused ("stuck, can't move"). The user clicks the world to capture it instead
      // (WorldView shows a "Click to play" prompt).
    };
  }, [state, mainThread]);
}
