import { useEffect, useRef } from "react";
import { Outlet } from "react-router-dom";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { useAtomValue, useSetAtom } from "jotai";
import { KBarProvider } from "kbar";

import "./SessionView.css";
import { useInitMainThreadContext, MainThreadContextProvider } from "../../hooks/useMainThread";
import { Overlay } from "./overlay/Overlay";
import { StatusBar } from "./statusbar/StatusBar";
import { LoadingScreen } from "../components/loading-screen/LoadingScreen";
import { useHomeWorldCheck, waitForRoom } from "../../hooks/useHomeWorld";
import { useWorldNavigator } from "../../hooks/useWorldNavigator";
import { enterHomeOnStartupAtom, homeWorldAtom } from "../../state/homeWorld";
import { HomeWelcome } from "./HomeWelcome";
import { useBuzzarSpace } from "../../hooks/useBuzzarSpace";
import { useReadSync } from "../../hooks/useReadSync";
import { useMatrix } from "../../hooks/useMatrix";
import { useWorldInAddress } from "../../hooks/useWorld";
import { overlayWorldAtom } from "../../state/overlayWorld";
import { overlayVisibilityAtom } from "../../state/overlayVisibility";
import { ScriptConsent } from "./world/ScriptConsent";
import { CmdPanel, defaultActions } from "./cmd-panel/CmdPanel";
import { useAccountManagementAction, useUserProfileAction } from "./cmd-panel/actions";
import { editorEnabledAtom } from "../../state/editor";
import { hudHiddenAtom } from "../../state/hud";
import { FirefoxPerfAlert } from "./dialogs/FirefoxPerfAlert";
import { DeviceVerificationDialog } from "./verification/DeviceVerificationDialog";
import { useThingKeysSync } from "../../hooks/useThingKeys";
import { useThingClonesSync } from "../../hooks/useThingClones";
import { useAutoRunSync } from "../../hooks/useAutoRun";
import { ConfirmDialogHost } from "../components/confirm-dialog/ConfirmDialog";

function RegisterKBarActions() {
  useUserProfileAction();
  useAccountManagementAction();
  return null;
}

/** Buzzar: on startup (no world in the address), go into your Home World (Settings → Worlds), or just show it.
 * Rendered inside the main-thread provider, since entering a world needs the engine. */
function EnterHomeOnStartup({ worldId, worldAlias }: { worldId?: string; worldAlias?: string }) {
  const { session } = useMatrix(true);
  const home = useAtomValue(homeWorldAtom);
  const homeWorldId = home.status === "ready" ? home.roomId : undefined;
  const selectWorld = useSetAtom(overlayWorldAtom);
  const enterHomeOnStartup = useAtomValue(enterHomeOnStartupAtom);
  const setOverlayVisible = useSetAtom(overlayVisibilityAtom);
  const { navigateEnterWorld } = useWorldNavigator(session);
  const startupHandled = useRef(false);
  useEffect(() => {
    if (startupHandled.current || !homeWorldId) return;
    startupHandled.current = true;
    if (worldId || worldAlias) return;
    if (!enterHomeOnStartup) {
      selectWorld(homeWorldId);
      return;
    }
    waitForRoom(session, homeWorldId)
      .then((room) => {
        setOverlayVisible(false);
        navigateEnterWorld(room);
      })
      .catch(() => selectWorld(homeWorldId));
  }, [
    worldId,
    worldAlias,
    homeWorldId,
    selectWorld,
    enterHomeOnStartup,
    session,
    navigateEnterWorld,
    setOverlayVisible,
  ]);

  return null;
}

export default function SessionView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mainThread = useInitMainThreadContext(canvasRef);
  const overlayVisible = useAtomValue(overlayVisibilityAtom);
  // Any world in the address, joined or not: start-up goes there instead of Home World.
  const [worldId, worldAlias] = useWorldInAddress();
  useHomeWorldCheck();
  useBuzzarSpace();
  const { session } = useMatrix(true);
  useReadSync(session);

  const editorEnabled = useAtomValue(editorEnabledAtom);
  const hudHidden = useAtomValue(hudHiddenAtom);

  return (
    <DndProvider backend={HTML5Backend}>
      <KBarProvider
        actions={defaultActions}
        options={{
          disableScrollbarManagement: true,
        }}
      >
        <CmdPanel />
        <RegisterKBarActions />
        <div className="SessionView">
          <canvas className="SessionView__viewport" ref={canvasRef} />
          {mainThread ? (
            <MainThreadContextProvider value={mainThread}>
              <ThingKeysSync />
              <AutoRunSync />
              <EnterHomeOnStartup worldId={worldId} worldAlias={worldAlias} />
              <Outlet />
              {overlayVisible && <Overlay />}
              {!editorEnabled && !(hudHidden && !overlayVisible) && <StatusBar />}
              <FirefoxPerfAlert />
              {/* Buzzar: no Home World yet: offer to create it (unless arriving at a particular world). */}
              {!worldId && !worldAlias && <HomeWelcome />}
              {/* Buzzar: world scripts ask here before reading the chat or posting as you. */}
              <ScriptConsent />
              {/* Buzzar: "Confirm your identity" after sign-in. In here so it can pause the player while it's open. */}
              <DeviceVerificationDialog />
              {/* Buzzar: the app's own confirm dialogs (confirmDialog), instead of the browser's. */}
              <ConfirmDialogHost />
              {/* Buzzar: Third Room's "What's new" modal removed. It reopened on every world entry and held keyboard focus, so movement didn't work until dismissed. */}
            </MainThreadContextProvider>
          ) : (
            <LoadingScreen message="Initializing engine..." />
          )}
        </div>
      </KBarProvider>
    </DndProvider>
  );
}

/** Buzzar: keeps the game's number-key Things in step with your account (needs the main thread context). */
function ThingKeysSync() {
  useThingKeysSync();
  useThingClonesSync();
  return null;
}

function AutoRunSync() {
  useAutoRunSync();
  return null;
}
