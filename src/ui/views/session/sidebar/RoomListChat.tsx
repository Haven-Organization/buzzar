import { useCallback, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";

import { useMatrix } from "../../../hooks/useMatrix";
import { Category } from "../../components/category/Category";
import { CategoryHeader } from "../../components/category/CategoryHeader";
import { useRoomsOfType, RoomTypes, roomTypeFilter } from "../../../hooks/useRoomsOfType";
import { RoomSelector } from "./selector/RoomSelector";
import { Icon } from "../../../atoms/icon/Icon";
import ChevronRightIC from "../../../../../res/ic/chevron-right.svg";
import ChevronBottomIC from "../../../../../res/ic/chevron-bottom.svg";
import { EmptyState } from "../../components/empty-state/EmptyState";
import { Button } from "../../../atoms/button/Button";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { DmDialog } from "../dialogs/DmDialog";
import { useDialog } from "../../../hooks/useDialog";
import { activeChatsAtom, openedChatAtom } from "../../../state/overlayChat";
import { overlayWorldAtom } from "../../../state/overlayWorld";
import { chatFilterAtom } from "../../../state/chatFilter";
import { useInviteList } from "../../../hooks/useInviteList";
import { Invite } from "../../../../matrix";
import { Avatar } from "../../../atoms/avatar/Avatar";
import { AvatarOutline } from "../../../atoms/avatar/AvatarOutline";
import { RoomTile } from "../../components/room-tile/RoomTile";
import { RoomTileTitle } from "../../components/room-tile/RoomTileTitle";
import { getAvatarHttpUrl, getIdentifierColorNumber } from "../../../utils/avatar";

/** Buzzar: the Chat list: invites, direct messages and rooms (worlds have their own screen now). */
export function RoomListChat() {
  const { session, platform } = useMatrix(true);

  const [allDirects] = useRoomsOfType(session, RoomTypes.Direct);
  const [allRooms] = useRoomsOfType(session, RoomTypes.Room);
  const invites = useInviteList(session);
  const [filter, setFilter] = useAtom(chatFilterAtom);
  const unreadOnly = filter === "unread";
  const directs = unreadOnly ? allDirects.filter((room) => room.isUnread) : allDirects;
  const rooms = unreadOnly ? allRooms.filter((room) => room.isUnread) : allRooms;

  const [inviteCat, setInviteCat] = useState(true);
  const [directCat, setDirectCat] = useState(true);
  const [roomCat, setRoomCat] = useState(true);
  const dm = useDialog(false);

  const openedChatId = useAtomValue(openedChatAtom);
  const setActiveChat = useSetAtom(activeChatsAtom);
  const [selectedWorldId, selectWorld] = useAtom(overlayWorldAtom);
  const onSelect = useCallback((roomId: string) => setActiveChat({ type: "OPEN", roomId }), [setActiveChat]);

  if (unreadOnly && directs.length === 0 && rooms.length === 0 && invites.length === 0) {
    return (
      <EmptyState
        style={{ minHeight: "400px" }}
        heading="All Caught Up"
        text="No chats with unread messages."
        actions={<Button onClick={() => setFilter("all")}>Show All Chats</Button>}
      />
    );
  }

  if (directs.length === 0 && rooms.length === 0 && invites.length === 0) {
    return (
      <EmptyState
        style={{ minHeight: "400px" }}
        heading="No Chats"
        text="You don't have any direct messages or rooms yet."
        actions={
          <>
            <Dialog open={dm.open} onOpenChange={dm.setOpen}>
              <DmDialog requestClose={dm.closeDialog} />
            </Dialog>
            <Button onClick={dm.openDialog}>Direct Message</Button>
          </>
        }
      />
    );
  }

  const renderRoom = (room: (typeof rooms)[number]) => (
    <RoomSelector
      key={room.id}
      isSelected={room.id === openedChatId}
      onSelect={onSelect}
      room={room}
      version={room.version}
      platform={platform}
    />
  );

  const renderInvite = (invite: Invite) => {
    const isWorld = roomTypeFilter(invite, RoomTypes.World);
    const avatar = (
      <Avatar
        name={invite.name || "Empty room"}
        size="lg"
        shape={isWorld || invite.isDirectMessage ? "circle" : "rounded"}
        className="shrink-0"
        bgColor={`var(--usercolor${getIdentifierColorNumber(invite.id)})`}
        imageSrc={
          invite.avatarUrl ? getAvatarHttpUrl(invite.avatarUrl, 50, platform, invite.mediaRepository) : undefined
        }
      />
    );
    const selected = openedChatId === invite.id || selectedWorldId === invite.id;
    return (
      <RoomTile
        key={invite.id}
        avatar={selected ? <AvatarOutline>{avatar}</AvatarOutline> : avatar}
        content={<RoomTileTitle>{invite.name || "Empty room"}</RoomTileTitle>}
        // A world invite opens its preview (join from there); rooms and DMs open the chat window's invite.
        onClick={() => (isWorld ? selectWorld(invite.id) : onSelect(invite.id))}
      />
    );
  };

  return (
    <>
      {invites.length > 0 && (
        <Category
          header={
            <CategoryHeader
              title={`Invites (${invites.length})`}
              after={<Icon src={inviteCat ? ChevronBottomIC : ChevronRightIC} size="sm" color="surface" />}
              onClick={() => setInviteCat(!inviteCat)}
            />
          }
        >
          {inviteCat && invites.map(renderInvite)}
        </Category>
      )}
      {directs.length > 0 && (
        <Category
          header={
            <CategoryHeader
              title="Direct Messages"
              after={<Icon src={directCat ? ChevronBottomIC : ChevronRightIC} size="sm" color="surface" />}
              onClick={() => setDirectCat(!directCat)}
            />
          }
        >
          {directCat && directs.map(renderRoom)}
        </Category>
      )}
      {rooms.length > 0 && (
        <Category
          header={
            <CategoryHeader
              title="Rooms"
              after={<Icon src={roomCat ? ChevronBottomIC : ChevronRightIC} size="sm" color="surface" />}
              onClick={() => setRoomCat(!roomCat)}
            />
          }
        >
          {roomCat && rooms.map(renderRoom)}
        </Category>
      )}
    </>
  );
}
