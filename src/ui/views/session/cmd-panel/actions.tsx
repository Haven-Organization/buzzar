import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useRegisterActions } from "kbar";
import { useCallback, useState } from "react";

import { GroupCall } from "../../../../matrix";
import { Thread } from "../../../../engine/module/module.common";
import { NametagsEnableMessage, NametagsEnableMessageType } from "../../../../engine/player/nametags.common";
import { NAME_MODE_LABEL, NameMode, nextNameMode } from "../../../utils/nameDisplay";
import { IconButton } from "../../../atoms/button/IconButton";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { Scroll } from "../../../atoms/scroll/Scroll";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { OverlayWindow, overlayWindowAtom } from "../../../state/overlayWindow";
import { overlayVisibilityAtom } from "../../../state/overlayVisibility";
import { hudHiddenAtom } from "../../../state/hud";
import { manageMuteRequest, MicExceptionDialog, useMuteButton } from "../../components/MuteButtonProvider";
import { useOpenOverlayWindow } from "../../../hooks/useOpenOverlayWindow";
import { ShortcutUI } from "../world/ShortcutUI";
import CrossIC from "../../../../../res/ic/cross.svg";
import { useDisableInput } from "../../../hooks/useDisableInput";
import { togglePhysicsDebug } from "../../../../engine/renderer/renderer.main";

enum ActionSection {
  Global = "Global",
  World = "World",
}

export const useUserProfileAction = () => {
  const setOverlayWindow = useSetAtom(overlayWindowAtom);
  const setOverlayVisibilityAtom = useSetAtom(overlayVisibilityAtom);

  useRegisterActions(
    [
      {
        id: "user-profile",
        name: "User Profile",
        shortcut: undefined,
        keywords: "user profile",
        section: ActionSection.Global,
        icon: undefined,
        subtitle: undefined,
        perform: () => {
          setOverlayVisibilityAtom(true);
          setOverlayWindow({ type: OverlayWindow.UserProfile });
        },
        parent: undefined,
      },
    ],
    []
  );
};

export const useAccountManagementAction = () => {
  const { session } = useHydrogen(true);
  const { accountManagementUrl } = session.sessionInfo;

  useRegisterActions(
    [
      {
        id: "manage-account",
        name: "Manage Account",
        shortcut: undefined,
        keywords: "account",
        section: ActionSection.Global,
        icon: undefined,
        subtitle: undefined,
        perform: () => window.open(accountManagementUrl),
        parent: undefined,
      },
    ],
    [accountManagementUrl]
  );
};

export const MuteButtonAction = ({
  activeCall,
  showToast,
}: {
  activeCall?: GroupCall;
  showToast?: (text: string) => void;
}) => {
  const { mute, requestStream, handleMute, micException, setMicException } = useMuteButton(activeCall);

  useRegisterActions(
    [
      {
        id: "toggle-mute",
        name: "Toggle Mute",
        shortcut: ["M"],
        keywords: "mute",
        section: ActionSection.World,
        icon: undefined,
        subtitle: undefined,
        perform: () => {
          showToast?.(!mute ? "Microphone Muted" : "Microphone Unmuted");
          handleMute(async () => manageMuteRequest(requestStream, setMicException));
        },
        parent: undefined,
      },
    ],
    [requestStream, showToast, mute]
  );

  return <MicExceptionDialog micException={micException} setMicException={setMicException} />;
};

/** Buzzar: N cycles names and banners → names only → hidden. */
export const useToggleNamesAction = (
  nameMode: NameMode,
  setNameMode: (value: NameMode) => void,
  showToast?: (text: string) => void
) => {
  const mainThread = useMainThreadContext();

  const toggleShowNames = useCallback(() => {
    const next = nextNameMode(nameMode);
    setNameMode(next);
    mainThread.sendMessage<NametagsEnableMessageType>(Thread.Game, {
      type: NametagsEnableMessage,
      enabled: next !== "off",
    });
    showToast?.(NAME_MODE_LABEL[next]);
  }, [mainThread, nameMode, showToast, setNameMode]);

  useRegisterActions(
    [
      {
        id: "toggle-names",
        name: "Toggle Names",
        shortcut: ["N"],
        keywords: "preview",
        section: ActionSection.World,
        icon: undefined,
        subtitle: undefined,
        perform: () => toggleShowNames(),
        parent: undefined,
      },
    ],
    [toggleShowNames]
  );
};

/** Buzzar: P opens the overlay's People screen on "In This World" (it used to open a separate members popup). */
export const MembersDialogAction = () => {
  const openOverlayWindow = useOpenOverlayWindow();
  const [overlayVisible, setOverlayVisibility] = useAtom(overlayVisibilityAtom);
  const overlayWindow = useAtomValue(overlayWindowAtom);
  const showingPeople = overlayVisible && overlayWindow.type === OverlayWindow.People;

  useRegisterActions(
    [
      {
        id: "members-dialog",
        name: "People",
        shortcut: ["P"],
        keywords: "members people",
        section: ActionSection.World,
        icon: undefined,
        subtitle: undefined,
        perform: () =>
          showingPeople ? setOverlayVisibility(false) : openOverlayWindow({ type: OverlayWindow.People, tab: "world" }),
        parent: undefined,
      },
    ],
    [showingPeople, openOverlayWindow, setOverlayVisibility]
  );

  return null;
};

/** Buzzar: H hides and shows the HUD (see hudHiddenAtom). */
export const useToggleHudAction = (showToast?: (text: string) => void) => {
  const [hudHidden, setHudHidden] = useAtom(hudHiddenAtom);

  useRegisterActions(
    [
      {
        id: "toggle-hud",
        name: "Toggle HUD",
        shortcut: ["H"],
        keywords: "hide interface ui screenshot",
        section: ActionSection.World,
        icon: undefined,
        subtitle: undefined,
        perform: () => {
          showToast?.(hudHidden ? "HUD shown" : "HUD hidden. Press H to show it.");
          setHudHidden(!hudHidden);
        },
        parent: undefined,
      },
    ],
    [hudHidden, setHudHidden, showToast]
  );
};

export const ShortcutDialogAction = () => {
  const [shortcutUI, setShortcutUI] = useState(false);

  useRegisterActions(
    [
      {
        id: "shortcuts-dialog",
        name: "Shortcuts",
        shortcut: ["/"],
        keywords: "shortcuts",
        section: ActionSection.World,
        icon: undefined,
        subtitle: undefined,
        perform: () => setShortcutUI((state) => !state),
        parent: undefined,
      },
    ],
    []
  );

  useDisableInput(shortcutUI);

  return (
    <Dialog open={shortcutUI} onOpenChange={setShortcutUI}>
      <Header
        left={<HeaderTitle size="lg">Controls</HeaderTitle>}
        right={<IconButton iconSrc={CrossIC} onClick={() => setShortcutUI((state) => !state)} label="Close" />}
      />
      <div className="flex" style={{ height: "600px" }}>
        <Scroll type="hover">
          <ShortcutUI />
        </Scroll>
      </div>
    </Dialog>
  );
};

export const useToggleEditorAction = (
  setOpen: (value: boolean | ((value: boolean) => boolean)) => void,
  havePermission: boolean,
  showToast?: (text: string) => void
) => {
  useRegisterActions(
    [
      {
        id: "editor",
        name: "Toggle Editor",
        shortcut: ["`"],
        keywords: "editor",
        section: ActionSection.World,
        icon: undefined,
        subtitle: undefined,
        perform: () => {
          if (havePermission) {
            setOpen((state) => !state);
          } else {
            showToast?.("You don't have permission to edit this scene.");
          }
        },
        parent: undefined,
      },
    ],
    [havePermission]
  );
};

export const useTogglePhysicsDebugAction = () => {
  const mainThread = useMainThreadContext();

  useRegisterActions(
    [
      {
        id: "physics-debug",
        name: "Toggle Physics Debug",
        keywords: "physics debug",
        section: ActionSection.World,
        icon: undefined,
        subtitle: undefined,
        perform: () => {
          togglePhysicsDebug(mainThread);
        },
        parent: undefined,
      },
    ],
    [mainThread]
  );
};

export const useToggleStatsAction = (setOpen: (value: boolean | ((value: boolean) => boolean)) => void) => {
  useRegisterActions(
    [
      {
        id: "stats",
        name: "Toggle Stats",
        shortcut: ["Shift+Control+S"],
        keywords: "stats",
        section: ActionSection.World,
        icon: undefined,
        subtitle: undefined,
        perform: () => setOpen((state) => !state),
        parent: undefined,
      },
    ],
    []
  );
};

export const EnterWebXRAction = ({ enter }: { enter: () => void }) => {
  useRegisterActions(
    [
      {
        id: "webxr",
        name: "Enter WebXR",
        shortcut: ["Alt+X"],
        keywords: "webxr",
        section: ActionSection.World,
        icon: undefined,
        subtitle: undefined,
        perform: () => enter(),
        parent: undefined,
      },
    ],
    []
  );

  return null;
};
