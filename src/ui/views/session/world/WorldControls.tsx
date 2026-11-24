import { forwardRef, useCallback, useEffect, useMemo, useState } from "react";
import { useSetAtom } from "jotai";
import classNames from "classnames";

import { GroupCall, Room, Session } from "../../../../matrix";
import { IconButton } from "../../../atoms/button/IconButton";
import { Tooltip } from "../../../atoms/tooltip/Tooltip";
import { Hotbar, HotbarSlot } from "../../components/hotbar/Hotbar";
import PeopleIC from "../../../../../res/ic/peoples.svg";
import SubtitlesIC from "../../../../../res/ic/subtitles.svg";
import SubtitlesOffIC from "../../../../../res/ic/subtitles-off.svg";
import MicIC from "../../../../../res/ic/mic.svg";
import MicOffIC from "../../../../../res/ic/mic-off.svg";
import CallCrossIC from "../../../../../res/ic/call-cross.svg";
import CrossIC from "../../../../../res/ic/cross.svg";
import HelpIC from "../../../../../res/ic/help.svg";
import DeleteIC from "../../../../../res/ic/bin.svg";
import FlyIC from "../../../../../res/ic/fly.svg";
import StraightenIC from "../../../../../res/ic/straighten.svg";
import FullscreenIC from "../../../../../res/ic/fullscreen.svg";
import FullscreenExitIC from "../../../../../res/ic/fullscreen-exit.svg";
import { fullscreenSupported, toggleFullscreen, useFullscreen } from "../../../utils/fullscreen";
import XRIC from "../../../../../res/ic/xr.svg";
import MenuIC from "../../../../../res/ic/menu.svg";
import ScreenShareIC from "../../../../../res/ic/screen-share.svg";
import RotateIC from "../../../../../res/ic/rotate.svg";
import { canShareScreens, useScreenShare } from "./ScreenShareDialog";
import { screenShareDialogAtom } from "../../../state/screenShareDialog";
import { Text } from "../../../atoms/text/Text";
import { NametagsEnableMessage, NametagsEnableMessageType } from "../../../../engine/player/nametags.common";
import { NAME_MODE_LABEL, NameMode, nextNameMode } from "../../../utils/nameDisplay";
import { Thread } from "../../../../engine/module/module.common";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { Header } from "../../../atoms/header/Header";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { Scroll } from "../../../atoms/scroll/Scroll";
import { ShortcutUI } from "./ShortcutUI";
import { useOpenOverlayWindow } from "../../../hooks/useOpenOverlayWindow";
import { OverlayWindow } from "../../../state/overlayWindow";
import { setLocalStorageItem } from "../../../hooks/useLocalStorage";
import { useKeyDown } from "../../../hooks/useKeyDown";
import { overlayVisibilityAtom } from "../../../state/overlayVisibility";
import { worldChatVisibilityAtom } from "../../../state/worldChatVisibility";
import { manageMuteRequest, MicExceptionDialog, useMuteButton } from "../../components/MuteButtonProvider";
import { inputFocused } from "../../../utils/common";
import { useDisableInput } from "../../../hooks/useDisableInput";
import { useWorldNavigator } from "../../../hooks/useWorldNavigator";
import { useActionBar } from "../../../hooks/useActionBar";
import { thingKeyName } from "../../../../plugins/thirdroom/thirdroom.common";
import { useMicLevel, useSpeaking } from "../../../hooks/useMicLevel";
import { useKeyBindings } from "../../../hooks/useKeyBindings";
import { isActionKey, keyLabel } from "../../../../engine/input/keyBindings";
import { useTouchControlsEnabled } from "../touch-controls/TouchControls";
import { TouchHudAction, TouchHudMenu } from "../touch-controls/TouchHudMenu";
import { pressVirtualButton } from "../../../../engine/input/touchControls";
import { PadButton } from "../../../../engine/input/gamepad.common";
import "./WorldControls.css";

export function HotbarControls() {
  const actionBarItems = useActionBar();

  return (
    <Hotbar>
      {actionBarItems.map((item, index) => (
        <HotbarSlot
          key={item.id}
          imageSrc={item.thumbnail}
          shortcutKey={item.slot !== undefined ? thingKeyName(item.slot) : String((index + 1) % 10)}
          label={item.label}
        />
      ))}
    </Hotbar>
  );
}

const MuteButton = forwardRef<HTMLButtonElement, { activeCall?: GroupCall; showToast: (text: string) => void }>(
  ({ activeCall, showToast }, ref) => {
    const { mute, requestStream, handleMute, micException, setMicException } = useMuteButton(activeCall);

    // Buzzar: light up the mic button while you're talking, so you can tell your mic is working and being sent.
    const [micStream, setMicStream] = useState<MediaStream>();
    useEffect(() => {
      const read = () => setMicStream(activeCall?.localMedia?.userMedia as unknown as MediaStream | undefined);
      read();
      return activeCall?.disposableOn("change", read);
    }, [activeCall]);
    const speaking = useSpeaking(useMicLevel(mute ? undefined : micStream)) && !mute;

    return (
      <>
        <MicExceptionDialog micException={micException} setMicException={setMicException} />
        <Tooltip content={mute ? "Unmute" : speaking ? "Mute (you're being heard)" : "Mute"}>
          <IconButton
            variant="world"
            className={classNames("WorldControls__mic", { "WorldControls__mic--speaking": speaking })}
            label="Mic"
            iconSrc={mute ? MicOffIC : MicIC}
            onClick={() => {
              showToast(!mute ? "Microphone Muted" : "Microphone Unmuted");
              handleMute(async () => manageMuteRequest(requestStream, setMicException));
            }}
            ref={ref}
          />
        </Tooltip>
      </>
    );
  }
);

export function WorldControls({
  className,
  session,
  activeCall,
  world,
  showToast,
  isWebXRSupported,
  enterXR,
  nameMode,
  setNameMode,
}: {
  className?: string;
  session: Session;
  activeCall?: GroupCall;
  world: Room;
  showToast: (text: string) => void;
  isWebXRSupported: boolean;
  enterXR: () => void;
  nameMode: NameMode;
  setNameMode: setLocalStorageItem<NameMode>;
}) {
  const keys = useKeyBindings();
  // Buzzar (Third Room #156): no keyboard with touch controls, so the buttons go without their key labels.
  const touchControls = useTouchControlsEnabled();
  // Buzzar: a fullscreen button where the browser allows it (not Safari on iPhone: add Buzzar to the home screen there).
  const fullscreen = useFullscreen();
  const canFullscreen = useMemo(() => fullscreenSupported(), []);
  const mainThread = useMainThreadContext();
  const { navigateExitWorld } = useWorldNavigator(session);

  const [shortcutUI, setShortcutUI] = useState(false);
  const setOverlayVisibility = useSetAtom(overlayVisibilityAtom);
  const setWorldChatVisibility = useSetAtom(worldChatVisibilityAtom);
  const openOverlay = () => {
    document.exitPointerLock();
    setWorldChatVisibility(false);
    setOverlayVisibility(true);
  };

  const openOverlayWindow = useOpenOverlayWindow();
  const showPeople = () => openOverlayWindow({ type: OverlayWindow.People, tab: "world" });
  const toggleShortcutUI = () => setShortcutUI((state) => !state);
  const showNames = nameMode !== "off";
  // Buzzar: names and banners → names only → hidden.
  const toggleShowNames = useCallback(() => {
    const next = nextNameMode(nameMode);
    setNameMode(next);
    mainThread.sendMessage<NametagsEnableMessageType>(Thread.Game, {
      type: NametagsEnableMessage,
      enabled: next !== "off",
    });
    showToast(NAME_MODE_LABEL[next]);
  }, [mainThread, nameMode, showToast, setNameMode]);

  useEffect(() => {
    mainThread.sendMessage<NametagsEnableMessageType>(Thread.Game, {
      type: NametagsEnableMessage,
      enabled: showNames,
    });
  }, [mainThread, showNames]);

  // Buzzar (Third Room #398): screen sharing, where the browser can (not phones).
  const showScreenShare = useMemo(() => canShareScreens(), []);
  const setScreenShareOpen = useSetAtom(screenShareDialogAtom);
  const [, screenShareState] = useScreenShare();
  const sharingScreen = !!screenShareState?.sharing;

  useKeyDown(
    (e) => {
      if (inputFocused()) return;

      // Buzzar: rebindable in Settings → Controls (keyBindings.ts); by default Alt + L leaves, Alt + S opens Share
      // Screen, Ctrl + F toggles fullscreen (not the browser's find) and Alt + X enters XR.
      if (isActionKey(e, "leave")) {
        navigateExitWorld();
      } else if (isActionKey(e, "screenshare") && showScreenShare) {
        e.preventDefault();
        setScreenShareOpen(true);
      } else if (isActionKey(e, "fullscreen") && canFullscreen) {
        e.preventDefault();
        toggleFullscreen();
      } else if (isActionKey(e, "xr") && isWebXRSupported) {
        e.preventDefault();
        enterXR();
      }
    },
    [enterXR, isWebXRSupported, showScreenShare, canFullscreen, navigateExitWorld, setScreenShareOpen]
  );

  useDisableInput(shortcutUI);

  const helpDialog = (
    <Dialog open={shortcutUI} onOpenChange={setShortcutUI}>
      <Header
        left={<HeaderTitle size="lg">Controls</HeaderTitle>}
        right={<IconButton iconSrc={CrossIC} onClick={toggleShortcutUI} label="Close" />}
      />
      <div className="flex" style={{ height: "600px" }}>
        <Scroll type="hover">
          <ShortcutUI />
        </Scroll>
      </div>
    </Dialog>
  );

  // Buzzar (Third Room #156): with touch controls, only the mic and a "More" button; the rest (and your Things, in
  // place of the numbered bar) are in its panel.
  if (touchControls) {
    const actions: TouchHudAction[] = [
      { label: "Menu", icon: MenuIC, onSelect: openOverlay },
      { label: "People", icon: PeopleIC, onSelect: showPeople },
      { label: NAME_MODE_LABEL[nameMode], icon: showNames ? SubtitlesIC : SubtitlesOffIC, onSelect: toggleShowNames },
      { label: "Controls", icon: HelpIC, onSelect: toggleShortcutUI },
      ...(showScreenShare
        ? [
            {
              label: sharingScreen ? "Sharing Screen" : "Share Screen",
              icon: ScreenShareIC,
              onSelect: () => setScreenShareOpen(true),
            },
          ]
        : []),
      // Deletes what you're aiming at (if it's yours), like X on a keyboard: a short press of the virtual pad's
      // D-pad left, which is bound to it.
      { label: "Delete Aimed", icon: DeleteIC, onSelect: () => pressVirtualButton(PadButton.DpadLeft) },
      // Moved off the screen to keep the touch buttons few: fly mode (D-pad right) and straightening what you hold (B).
      { label: "Fly", icon: FlyIC, onSelect: () => pressVirtualButton(PadButton.DpadRight) },
      { label: "Straighten Held", icon: StraightenIC, onSelect: () => pressVirtualButton(PadButton.B) },
      // Turns what you hold 45° (LB); holding R (or B) and moving the mouse or right stick turns it freely.
      { label: "Turn Held", icon: RotateIC, onSelect: () => pressVirtualButton(PadButton.LB) },
    ];
    if (canFullscreen) {
      actions.push({
        label: fullscreen ? "Exit Fullscreen" : "Fullscreen",
        icon: fullscreen ? FullscreenExitIC : FullscreenIC,
        onSelect: () => toggleFullscreen(),
      });
    }
    if (isWebXRSupported) actions.push({ label: "Enter XR", icon: XRIC, onSelect: enterXR });
    actions.push({ label: "Leave World", icon: CallCrossIC, onSelect: navigateExitWorld, danger: true });
    return (
      <div className={classNames(className, "flex flex-column items-end gap-xs WorldControls--touch")}>
        {helpDialog}
        <TouchHudMenu actions={actions}>
          {activeCall && <MuteButton showToast={showToast} activeCall={activeCall} />}
        </TouchHudMenu>
      </div>
    );
  }

  return (
    <div className={classNames(className, "flex")}>
      {canFullscreen && (
        <div className="flex flex-column items-center">
          <Tooltip content={fullscreen ? "Exit Fullscreen" : "Fullscreen"}>
            <IconButton
              variant="world"
              label={fullscreen ? "Exit Fullscreen" : "Fullscreen"}
              iconSrc={fullscreen ? FullscreenExitIC : FullscreenIC}
              onClick={(e) => {
                // Don't keep focus: keys and touch go to the world again straight away.
                e.currentTarget.blur();
                toggleFullscreen();
              }}
            />
          </Tooltip>
          <Text variant="b3" color="world" weight="bold">
            {keyLabel(keys.fullscreen)}
          </Text>
        </div>
      )}
      <div className="flex flex-column items-center">
        <Tooltip content="Menu">
          <IconButton variant="world" label="Menu" iconSrc={MenuIC} onClick={openOverlay} />
        </Tooltip>
        <Text variant="b3" color="world" weight="bold">
          Tab
        </Text>
      </div>
      <div className="flex flex-column items-center">
        <Tooltip content={shortcutUI ? "Hide Help" : "Show Help"}>
          <IconButton variant="world" label="help" iconSrc={HelpIC} onClick={toggleShortcutUI} />
        </Tooltip>
        <Text variant="b3" color="world" weight="bold">
          {keyLabel(keys.controls)}
        </Text>
        {helpDialog}
      </div>
      {isWebXRSupported && (
        <div className="flex flex-column items-center">
          <Tooltip content="Enter XR">
            <IconButton variant="world" label="Enter XR" iconSrc={XRIC} onClick={enterXR} />
          </Tooltip>
          <Text variant="b3" color="world" weight="bold">
            {keyLabel(keys.xr)}
          </Text>
        </div>
      )}
      <div className="flex flex-column items-center">
        <Tooltip content="People">
          <IconButton variant="world" label="People" iconSrc={PeopleIC} onClick={showPeople} />
        </Tooltip>
        <Text variant="b3" color="world" weight="bold">
          {keyLabel(keys.people)}
        </Text>
      </div>
      <div className="flex flex-column items-center">
        <Tooltip content={`${NAME_MODE_LABEL[nameMode]} (${keyLabel(keys.names)} to change)`}>
          <IconButton
            variant="world"
            label="Toggle Names"
            iconSrc={showNames ? SubtitlesIC : SubtitlesOffIC}
            onClick={toggleShowNames}
          />
        </Tooltip>
        <Text variant="b3" color="world" weight="bold">
          {keyLabel(keys.names)}
        </Text>
      </div>
      {activeCall && (
        <div className="flex flex-column items-center">
          <MuteButton showToast={showToast} activeCall={activeCall} />
          <Text variant="b3" color="world" weight="bold">
            {keyLabel(keys.mute)}
          </Text>
        </div>
      )}
      <div className="flex flex-column items-center">
        <Tooltip content="Disconnect">
          <IconButton variant="danger" label="Disconnect" iconSrc={CallCrossIC} onClick={navigateExitWorld} />
        </Tooltip>
        <Text variant="b3" color="world" weight="bold">
          {keyLabel(keys.leave)}
        </Text>
      </div>
    </div>
  );
}
