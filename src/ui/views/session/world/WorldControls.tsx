import { forwardRef, useCallback, useEffect, useState } from "react";
import { useSetAtom } from "jotai";
import { GroupCall, Room, Session } from "@thirdroom/hydrogen-view-sdk";
import classNames from "classnames";

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
import XRIC from "../../../../../res/ic/xr.svg";
import MenuIC from "../../../../../res/ic/menu.svg";
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

  useKeyDown(
    (e) => {
      if (inputFocused()) return;

      if (e.altKey && e.code === "KeyL") {
        navigateExitWorld();
      }
    },
    [enterXR, isWebXRSupported]
  );

  useDisableInput(shortcutUI);

  return (
    <div className={classNames(className, "flex")}>
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
          /
        </Text>
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
      </div>
      {isWebXRSupported && (
        <div className="flex flex-column items-center">
          <Tooltip content="Enter XR">
            <IconButton variant="world" label="Enter XR" iconSrc={XRIC} onClick={enterXR} />
          </Tooltip>
          <Text variant="b3" color="world" weight="bold">
            Alt + X
          </Text>
        </div>
      )}
      <div className="flex flex-column items-center">
        <Tooltip content="People">
          <IconButton variant="world" label="People" iconSrc={PeopleIC} onClick={showPeople} />
        </Tooltip>
        <Text variant="b3" color="world" weight="bold">
          P
        </Text>
      </div>
      <div className="flex flex-column items-center">
        <Tooltip content={`${NAME_MODE_LABEL[nameMode]} (N to change)`}>
          <IconButton
            variant="world"
            label="Toggle Names"
            iconSrc={showNames ? SubtitlesIC : SubtitlesOffIC}
            onClick={toggleShowNames}
          />
        </Tooltip>
        <Text variant="b3" color="world" weight="bold">
          N
        </Text>
      </div>
      {activeCall && (
        <div className="flex flex-column items-center">
          <MuteButton showToast={showToast} activeCall={activeCall} />
          <Text variant="b3" color="world" weight="bold">
            M
          </Text>
        </div>
      )}
      <div className="flex flex-column items-center">
        <Tooltip content="Disconnect">
          <IconButton variant="danger" label="Disconnect" iconSrc={CallCrossIC} onClick={navigateExitWorld} />
        </Tooltip>
        <Text variant="b3" color="world" weight="bold">
          Alt + L
        </Text>
      </div>
    </div>
  );
}
