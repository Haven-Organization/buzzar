import { MouseEventHandler, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";

import { GroupCall, Platform, Room } from "../../../../matrix";
import { Avatar } from "../../../atoms/avatar/Avatar";
import { AvatarOutline } from "../../../atoms/avatar/AvatarOutline";
import { IconButton } from "../../../atoms/button/IconButton";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { DropdownMenu } from "../../../atoms/menu/DropdownMenu";
import { DropdownMenuItem } from "../../../atoms/menu/DropdownMenuItem";
import { Tooltip } from "../../../atoms/tooltip/Tooltip";
import { getAvatarHttpUrl, getIdentifierColorNumber } from "../../../utils/avatar";
import { NowPlaying } from "../../components/now-playing/NowPlaying";
import { NowPlayingStatus } from "../../components/now-playing/NowPlayingStatus";
import { NowPlayingTitle } from "../../components/now-playing/NowPlayingTitle";
import MicIC from "../../../../../res/ic/mic.svg";
import MicOffIC from "../../../../../res/ic/mic-off.svg";
import CallCrossIC from "../../../../../res/ic/call-cross.svg";
import MoreHorizontalIC from "../../../../../res/ic/more-horizontal.svg";
import MessageIC from "../../../../../res/ic/message.svg";
import { InviteDialog } from "../dialogs/InviteDialog";
import { activeChatsAtom, openedChatAtom } from "../../../state/overlayChat";
import { manageMuteRequest, MicExceptionDialog, useMuteButton } from "../../components/MuteButtonProvider";
import { OverlayWindow, overlayWindowAtom } from "../../../state/overlayWindow";
import { usePowerLevels } from "../../../hooks/usePowerLevels";
import { useMatrix } from "../../../hooks/useMatrix";
import { screenShareDialogAtom } from "../../../state/screenShareDialog";
import { useKeyBindings } from "../../../hooks/useKeyBindings";
import { keyLabel } from "../../../../engine/input/keyBindings";
import { canShareScreens, useScreenShare } from "../world/ScreenShareDialog";
import ScreenShareIC from "../../../../../res/ic/screen-share.svg";

interface NowPlayingWorldProps {
  world: Room;
  activeCall: GroupCall;
  onExitWorld: MouseEventHandler<HTMLButtonElement>;
  platform: Platform;
}

export function NowPlayingWorld({ world, activeCall, onExitWorld, platform }: NowPlayingWorldProps) {
  const { session } = useMatrix(true);
  const setActiveChat = useSetAtom(activeChatsAtom);
  const openedChatId = useAtomValue(openedChatAtom);
  const setOverlayWindow = useSetAtom(overlayWindowAtom);
  const setScreenShareOpen = useSetAtom(screenShareDialogAtom);
  const keys = useKeyBindings();
  const [, screenShareState] = useScreenShare();
  const sharingScreen = !!screenShareState?.sharing;
  const { getPowerLevel, canSendStateEvent } = usePowerLevels(world);

  const [inviteDialog, setInviteDialog] = useState(false);
  const { mute, requestStream, handleMute, micException, setMicException } = useMuteButton(activeCall);

  return (
    <NowPlaying
      avatar={
        <AvatarOutline>
          <Avatar
            shape="circle"
            size="lg"
            name={world.name || "Unnamed World"}
            bgColor={`var(--usercolor${getIdentifierColorNumber(world.id)})`}
            imageSrc={world.avatarUrl && getAvatarHttpUrl(world.avatarUrl, 70, platform, world.mediaRepository)}
          />
        </AvatarOutline>
      }
      content={
        <>
          <NowPlayingStatus status="connected">Connected</NowPlayingStatus>
          <NowPlayingTitle>{world.name || "Unnamed World"}</NowPlayingTitle>
        </>
      }
      options={
        <Tooltip side="top" content={openedChatId === world.id ? "Minimize Chat" : "Open Chat"}>
          <IconButton
            onClick={() => setActiveChat({ type: openedChatId === world.id ? "MINIMIZE" : "OPEN", roomId: world.id })}
            variant="surface-low"
            label="Options"
            iconSrc={MessageIC}
          />
        </Tooltip>
      }
      leftControls={
        <>
          <MicExceptionDialog micException={micException} setMicException={setMicException} />
          <Tooltip content={mute ? "Unmute" : "Mute"}>
            <IconButton
              variant="surface-low"
              label="Mic"
              iconSrc={mute ? MicOffIC : MicIC}
              onClick={() => {
                handleMute(async () => manageMuteRequest(requestStream, setMicException));
              }}
            />
          </Tooltip>
          {canShareScreens() && (
            // Buzzar (Third Room #398): Share Screen (also Alt + S in the world).
            <Tooltip
              content={`${sharingScreen ? "Sharing Your Screen" : "Share Your Screen"} (${keyLabel(keys.screenshare)})`}
            >
              <IconButton
                variant={sharingScreen ? "primary" : "surface-low"}
                label="Share Screen"
                iconSrc={ScreenShareIC}
                onClick={() => setScreenShareOpen(true)}
              />
            </Tooltip>
          )}
          <Tooltip content="Disconnect">
            <IconButton variant="danger" label="Disconnect" iconSrc={CallCrossIC} onClick={onExitWorld} />
          </Tooltip>
        </>
      }
      rightControls={
        <>
          <Dialog open={inviteDialog} onOpenChange={setInviteDialog}>
            <InviteDialog roomId={world.id} requestClose={() => setInviteDialog(false)} />
          </Dialog>
          <DropdownMenu
            content={
              <>
                <DropdownMenuItem onSelect={() => setInviteDialog(true)}>Invite</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setOverlayWindow({ type: OverlayWindow.People, tab: "world" })}>
                  People
                </DropdownMenuItem>
                {canSendStateEvent(undefined, getPowerLevel(session.userId)) && (
                  <DropdownMenuItem
                    onSelect={() =>
                      setOverlayWindow({
                        type: OverlayWindow.WorldSettings,
                        roomId: world.id,
                      })
                    }
                  >
                    Settings
                  </DropdownMenuItem>
                )}
              </>
            }
          >
            <IconButton variant="surface-low" label="Options" iconSrc={MoreHorizontalIC} />
          </DropdownMenu>
        </>
      }
    />
  );
}
