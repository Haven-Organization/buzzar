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
import { useHomeWorld } from "../../hooks/useHomeWorld";
import { useBuzzarSpace } from "../../hooks/useBuzzarSpace";
import { useReadSync } from "../../hooks/useReadSync";
import { useHydrogen } from "../../hooks/useHydrogen";
import { useUnknownWorldPath } from "../../hooks/useWorld";
import { overlayWorldAtom } from "../../state/overlayWorld";
import { overlayVisibilityAtom } from "../../state/overlayVisibility";
import { ScriptConsent } from "./world/ScriptConsent";
import { CmdPanel, defaultActions } from "./cmd-panel/CmdPanel";
import { useAccountManagementAction, useUserProfileAction } from "./cmd-panel/actions";
import { editorEnabledAtom } from "../../state/editor";
import { hudHiddenAtom } from "../../state/hud";
import { FirefoxPerfAlert } from "./dialogs/FirefoxPerfAlert";
import { DeviceVerificationDialog } from "./verification/DeviceVerificationDialog";

function RegisterKBarActions() {
  useUserProfileAction();
  useAccountManagementAction();
  return null;
}

export default function SessionView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mainThread = useInitMainThreadContext(canvasRef);
  const overlayVisible = useAtomValue(overlayVisibilityAtom);
  const [worldId, worldAlias] = useUnknownWorldPath();
  const homeWorldId = useHomeWorld();
  useBuzzarSpace();
  const { session } = useHydrogen(true);
  useReadSync(session);
  const selectWorld = useSetAtom(overlayWorldAtom);

  const editorEnabled = useAtomValue(editorEnabledAtom);
  const hudHidden = useAtomValue(hudHiddenAtom);

  useEffect(() => {
    if (!worldId && !worldAlias && homeWorldId) {
      selectWorld(homeWorldId);
    }
  }, [worldId, worldAlias, homeWorldId, selectWorld]);

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
          <DeviceVerificationDialog />
          {mainThread ? (
            <MainThreadContextProvider value={mainThread}>
              <Outlet />
              {overlayVisible && <Overlay />}
              {!editorEnabled && !(hudHidden && !overlayVisible) && <StatusBar />}
              <FirefoxPerfAlert />
              {/* Buzzar: world scripts ask here before reading the chat or posting as you. */}
              <ScriptConsent />
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
