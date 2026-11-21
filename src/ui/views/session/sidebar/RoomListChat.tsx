import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";

import { useMatrix } from "../../../hooks/useMatrix";
import { Category } from "../../components/category/Category";
import { CategoryHeader } from "../../components/category/CategoryHeader";
import { useRoomsOfType, RoomTypes } from "../../../hooks/useRoomsOfType";
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

/** Buzzar: the Chat list: direct messages and rooms (worlds have their own screen now). */
export function RoomListChat() {
  const { session, platform } = useMatrix(true);

  const [directs] = useRoomsOfType(session, RoomTypes.Direct);
  const [rooms] = useRoomsOfType(session, RoomTypes.Room);

  const [directCat, setDirectCat] = useState(true);
  const [roomCat, setRoomCat] = useState(true);
  const dm = useDialog(false);

  const openedChatId = useAtomValue(openedChatAtom);
  const setActiveChat = useSetAtom(activeChatsAtom);

  if (directs.length === 0 && rooms.length === 0) {
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
      onSelect={(roomId) => setActiveChat({ type: "OPEN", roomId })}
      room={room}
      platform={platform}
    />
  );

  return (
    <>
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
