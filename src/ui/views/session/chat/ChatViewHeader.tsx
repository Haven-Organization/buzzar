import { Invite, Platform, Room, Session } from "@thirdroom/hydrogen-view-sdk";

import { ChatHeader } from "../../components/chat-header/ChatHeader";
import { Avatar } from "../../../atoms/avatar/Avatar";
import { IconButton } from "../../../atoms/button/IconButton";
import { getAvatarHttpUrl, getIdentifierColorNumber } from "../../../utils/avatar";
import CrossIC from "../../../../../res/ic/cross.svg";
import MinusIC from "../../../../../res/ic/minus.svg";
import AddUserIC from "../../../../../res/ic/add-user.svg";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { useDialog } from "../../../hooks/useDialog";
import { InviteDialog } from "../dialogs/InviteDialog";

interface ChatViewHeaderProps {
  room: Room | Invite;
  session: Session;
  platform: Platform;
  onMinimize: (roomId: string) => void;
  onClose: (roomId: string) => void;
}

export function ChatViewHeader({ room, platform, session, onMinimize, onClose }: ChatViewHeaderProps) {
  const roomName = room.name || "Empty room";
  // Buzzar: invite people from the chat itself (Third Room #97). Not for pending invites or one-to-one DMs.
  const invite = useDialog(false);
  const canInvite = !!session.rooms.get(room.id) && !room.isDirectMessage;

  return (
    <ChatHeader
      className="shrink-0"
      avatar={
        <Avatar
          imageSrc={
            room.avatarUrl ? getAvatarHttpUrl(room.avatarUrl, 50, platform, session.mediaRepository) : undefined
          }
          size="sm"
          name={roomName}
          bgColor={`var(--usercolor${getIdentifierColorNumber(room.id)})`}
        />
      }
      title={roomName}
      options={
        <>
          {canInvite && (
            <>
              <Dialog open={invite.open} onOpenChange={invite.setOpen}>
                <InviteDialog roomId={room.id} requestClose={invite.closeDialog} />
              </Dialog>
              <IconButton variant="surface" label="Invite" iconSrc={AddUserIC} onClick={invite.openDialog} />
            </>
          )}
          <IconButton variant="surface" label="Minimize" iconSrc={MinusIC} onClick={() => onMinimize(room.id)} />
          <IconButton variant="surface" label="Close" iconSrc={CrossIC} onClick={() => onClose(room.id)} />
        </>
      }
    />
  );
}
