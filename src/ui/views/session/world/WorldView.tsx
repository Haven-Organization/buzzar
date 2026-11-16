import { useCallback, useEffect, useRef, useState } from "react";
import { Room } from "@thirdroom/hydrogen-view-sdk";
import classNames from "classnames";
import { useAtom, useAtomValue } from "jotai";
import { useKBar, VisualState } from "kbar";

import {
  installPointerLockTracking,
  markGameResumed,
  requestGamePointerLock,
  resumedRecently,
  wasReleasedByCode,
} from "../../../utils/pointerLock";
import { WorldChat } from "../world-chat/WorldChat";
import { Stats } from "../stats/Stats";
import { Text } from "../../../atoms/text/Text";
import { useKeyDown } from "../../../hooks/useKeyDown";
import { useEvent } from "../../../hooks/useEvent";
import "./WorldView.css";
import { EditorView } from "../editor/EditorView";
import { Nametags } from "../nametags/Nametags";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { getModule, registerMessageHandler } from "../../../../engine/module/module.common";
import { useToast } from "../../../hooks/useToast";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { MainContext } from "../../../../engine/MainThread";
import { createDisposables } from "../../../../engine/utils/createDisposables";
import { useCalls } from "../../../hooks/useCalls";
import { useRoomCall } from "../../../hooks/useRoomCall";
import { useWebXRSession } from "../../../hooks/useWebXRSession";
import { worldChatVisibilityAtom } from "../../../state/worldChatVisibility";
import { overlayVisibilityAtom } from "../../../state/overlayVisibility";
import { worldNoticeAtom } from "../../../state/worldNotice";
import { useNameMode } from "../../../utils/nameDisplay";
import { useWorldRules } from "../../../hooks/useWorldRules";
import { worldAtom } from "../../../state/world";
import { PlayerModule } from "../../../../engine/player/Player.main";
import { HotbarControls, WorldControls } from "./WorldControls";
import { WorldOnboarding } from "./WorldOnboarding";
import { WorldInteraction } from "./WorldInteraction";
import {
  EnterWebXRAction,
  MembersDialogAction,
  MuteButtonAction,
  ShortcutDialogAction,
  useToggleEditorAction,
  useTogglePhysicsDebugAction,
  useToggleNamesAction,
  useToggleStatsAction,
} from "../cmd-panel/actions";
import { inputFocused } from "../../../utils/common";
import { useDisableInput } from "../../../hooks/useDisableInput";
import { WorldUpgradedDialog } from "./WorldUpgradedDialog";
import { editorEnabledAtom } from "../../../state/editor";
import { usePowerLevels } from "../../../hooks/usePowerLevels";
import { ObjectCapReachedMessage, ThirdRoomMessageType } from "../../../../plugins/thirdroom/thirdroom.common";

interface WorldViewProps {
  world: Room;
}

export function WorldView({ world }: WorldViewProps) {
  const mainThread = useMainThreadContext();
  const { session } = useHydrogen(true);
  const { getPowerLevel, canSendStateEvent } = usePowerLevels(world);
  const canEditScene = canSendStateEvent("org.matrix.msc3815.world", getPowerLevel(session.userId));
  const calls = useCalls(session);
  const activeCall = useRoomCall(calls, world.id);
  const isWorldEntered = useAtomValue(worldAtom).entered;
  const [worldChatVisible, setWorldChatVisibility] = useAtom(worldChatVisibilityAtom);
  const [overlayVisible, setOverlayVisibility] = useAtom(overlayVisibilityAtom);
  const [editorEnabled, setEditorEnabled] = useAtom(editorEnabledAtom);
  const [pointerLocked, setPointerLocked] = useState(document.pointerLockElement === mainThread.canvas);
  // Buzzar: "Click to play" only when the player stepped away on purpose (Tab, or switching windows). Otherwise the
  // keyboard already works without the lock and the first click on the world takes the mouse for looking around.
  const [mouseFreed, setMouseFreed] = useState(false);
  useEffect(() => {
    if (pointerLocked) setMouseFreed(false);
  }, [pointerLocked]);
  useEffect(() => {
    const onBlur = () => setMouseFreed(true);
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);
  // If the click that entered the world still counts as a user gesture, take the pointer now (the lock taken on
  // that click may have been refused, e.g. right after Escape released one).
  useEffect(() => {
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (isWorldEntered && activation?.isActive && document.pointerLockElement !== mainThread.canvas) {
      requestGamePointerLock(mainThread.canvas);
    }
  }, [isWorldEntered, mainThread]);

  // Buzzar: latest UI state for the pointer-lock listener below.
  const uiStateRef = useRef({ isWorldEntered, overlayVisible, worldChatVisible, editorEnabled });
  uiStateRef.current = { isWorldEntered, overlayVisible, worldChatVisible, editorEnabled };

  useEffect(() => {
    installPointerLockTracking();
    let wasLocked = document.pointerLockElement === mainThread.canvas;
    const update = () => {
      const locked = document.pointerLockElement === mainThread.canvas;
      setPointerLocked(locked);
      // Buzzar: the browser consumes the Escape that releases pointer lock, so the page never sees it. If the lock
      // was released by the browser (not our own code) while the window still has focus, that was Escape: open the
      // overlay now instead of needing a second press. (Alt-Tab releases it too, but the window has lost focus.)
      const ui = uiStateRef.current;
      if (
        wasLocked &&
        !locked &&
        !wasReleasedByCode() &&
        document.hasFocus() &&
        ui.isWorldEntered &&
        !ui.overlayVisible &&
        !ui.worldChatVisible &&
        !ui.editorEnabled &&
        !resumedRecently() &&
        !getModule(mainThread, PlayerModule).orbiting
      ) {
        setOverlayVisibility(true);
      }
      wasLocked = locked;
    };
    document.addEventListener("pointerlockchange", update);
    return () => document.removeEventListener("pointerlockchange", update);
  }, [mainThread, setOverlayVisibility]);
  const [statsEnabled, setStatsEnabled] = useState(false);

  const { toastShown, toastContent, showToast } = useToast();

  // Buzzar: the world's object rules go to the engine; moderators hear about blocked attempts.
  const notifyModerator = useCallback((text: string) => showToast(text, 6000), [showToast]);
  useWorldRules(world, activeCall, notifyModerator);

  // Buzzar: one-off notices about this world (e.g. its script wasn't run or stopped).
  const [worldNotice, setWorldNotice] = useAtom(worldNoticeAtom);
  useEffect(() => {
    if (!worldNotice) return;
    showToast(worldNotice.text, 8000);
    setWorldNotice(undefined);
  }, [worldNotice, setWorldNotice, showToast]);

  const camRigModule = getModule(mainThread, PlayerModule);
  const [nameMode, setNameMode] = useNameMode();
  const showNames = nameMode !== "off";
  const { isWebXRSupported, enterXR, isPresenting } = useWebXRSession();

  const { kbarVisible } = useKBar((state) => ({ kbarVisible: state.visualState !== VisualState.hidden }));
  useDisableInput(kbarVisible);

  useToggleNamesAction(nameMode, setNameMode, showToast);
  useToggleEditorAction(setEditorEnabled, canEditScene, showToast);
  useTogglePhysicsDebugAction();
  useToggleStatsAction(setStatsEnabled);

  useEffect(() => {
    const onObjectCapReached = (ctx: MainContext, message: ObjectCapReachedMessage) => {
      showToast("Maximum number of objects reached.");
    };

    const disposables = createDisposables([
      registerMessageHandler(mainThread, ThirdRoomMessageType.ObjectCapReached, onObjectCapReached),
    ]);
    return () => {
      disposables();
    };
  }, [mainThread, showToast]);

  useKeyDown(
    (e) => {
      if (e.key === "Escape" && camRigModule.orbiting) {
        return;
      }

      if (e.key === "Escape") {
        // Buzzar: a held Escape repeats; only the first press toggles anything.
        if (e.repeat) return;
        if (worldChatVisible) {
          requestGamePointerLock(mainThread.canvas);
          setWorldChatVisibility(false);
          return;
        }

        if (inputFocused()) return;

        if (editorEnabled) {
          requestGamePointerLock(mainThread.canvas);
          setEditorEnabled(false);
          return;
        }

        if (overlayVisible) {
          markGameResumed();
          requestGamePointerLock(mainThread.canvas);
          setOverlayVisibility(false);
          return;
        } else {
          document.exitPointerLock();
          setOverlayVisibility(true);
          return;
        }
      }

      if (inputFocused()) return;

      // Buzzar: Tab frees the mouse without opening anything (Escape now frees it and opens the overlay).
      if (e.code === "Tab" && document.pointerLockElement === mainThread.canvas) {
        e.preventDefault();
        setMouseFreed(true);
        document.exitPointerLock();
        return;
      }

      if (e.key === "Enter" && !overlayVisible && !worldChatVisible) {
        if (document.activeElement !== document.body) return;
        document.exitPointerLock();
        setWorldChatVisibility(true);
        return;
      }
    },
    [worldChatVisible, overlayVisible, editorEnabled]
  );

  useEvent(
    "click",
    (e) => {
      if (isWorldEntered === false) return;

      // Buzzar: only lock when not already locked. Re-requesting while locked fires another pointerlockchange,
      // whose key reset dropped held keys (a click while sprinting stopped the sprint).
      if (!camRigModule.orbiting && !editorEnabled && document.pointerLockElement !== mainThread.canvas) {
        requestGamePointerLock(mainThread.canvas);
      }

      if (worldChatVisible) setWorldChatVisibility(false);
      if (overlayVisible) setOverlayVisibility(false);
    },
    mainThread.canvas,
    [isWorldEntered, worldChatVisible, setWorldChatVisibility, overlayVisible, setOverlayVisibility, editorEnabled]
  );

  useEffect(() => {
    // Buzzar: make sure keyboard input goes to the game, not a leftover focused button/input from the UI.
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    // No requestPointerLock() here: a lock taken from code after a menu click left keyboard input dead in
    // Chromium. The "Click to play" prompt asks for a click on the world instead.
  }, [mainThread]);

  if (isPresenting) return null;

  return (
    <div className="WorldView">
      {isWorldEntered && mouseFreed && !pointerLocked && !overlayVisible && !worldChatVisible && !editorEnabled && (
        // Buzzar: the pointer is only captured by clicking the world (see useDisableInput for why).
        <div className="WorldView__click-to-play">
          <Text color="world" weight="semi-bold">
            Click to play
          </Text>
        </div>
      )}
      <MuteButtonAction activeCall={activeCall} showToast={showToast} />
      <MembersDialogAction />
      <ShortcutDialogAction />
      {isWebXRSupported && <EnterWebXRAction enter={enterXR} />}

      <WorldOnboarding world={world} />
      {!("isBeingCreated" in world) && <WorldUpgradedDialog world={world} />}
      <Stats statsEnabled={statsEnabled} />
      <div className={classNames("WorldView__chat flex", { "WorldView__chat--open": worldChatVisible })}>
        {!("isBeingCreated" in world) && !editorEnabled && <WorldChat open={worldChatVisible} room={world} />}
      </div>
      {world && !editorEnabled && (
        <>
          {!worldChatVisible && <HotbarControls />}
          <WorldControls
            className="WorldView__controls"
            session={session}
            world={world}
            activeCall={activeCall}
            showToast={showToast}
            isWebXRSupported={isWebXRSupported}
            enterXR={enterXR}
            nameMode={nameMode}
            setNameMode={setNameMode}
          />
        </>
      )}
      {world && editorEnabled && <EditorView room={world} />}
      {!("isBeingCreated" in world) && <Nametags room={world} show={showNames && !overlayVisible} showBanners={nameMode === "all"} />}

      {!overlayVisible && !editorEnabled && (
        <WorldInteraction session={session} world={world} activeCall={activeCall} />
      )}

      <div className="WorldView__toast-container">
        <div className={classNames("WorldView__toast", { "WorldView__toast--shown": toastShown })}>
          <Text variant="b2" color="world" weight="semi-bold">
            {toastContent}
          </Text>
        </div>
      </div>
    </div>
  );
}
