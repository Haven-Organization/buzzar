import { useAtom, useAtomValue } from "jotai";

import AddIC from "../../../../../res/ic/add.svg";
import FilterIC from "../../../../../res/ic/filter.svg";
import { chatFilterAtom } from "../../../state/chatFilter";
import { Text } from "../../../atoms/text/Text";
import "./RoomListHeader.css";
import { IconButton } from "../../../atoms/button/IconButton";
import { DmDialog } from "../dialogs/DmDialog";
import { JoinWithAliasDialog } from "../dialogs/JoinWithAliasDialog";
import { CreateRoomDialog } from "../dialogs/CreateRoomDialog";
import { DropdownMenu } from "../../../atoms/menu/DropdownMenu";
import { DropdownMenuItem } from "../../../atoms/menu/DropdownMenuItem";
import { useDialog } from "../../../hooks/useDialog";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { sidebarTabAtom, SidebarTab } from "../../../state/sidebarTab";

export function RoomListHeader() {
  const sidebarTab = useAtomValue(sidebarTabAtom);
  const { open, setOpen, openDialog, closeDialog } = useDialog(false);
  const {
    open: openJoin,
    setOpen: setJoinOpen,
    openDialog: openJoinDialog,
    closeDialog: closeJoinDialog,
  } = useDialog(false);
  const create = useDialog(false);
  const [chatFilter, setChatFilter] = useAtom(chatFilterAtom);

  return (
    <header className="RoomListHeader shrink-0 flex items-center gap-xs">
      {sidebarTab === SidebarTab.Chat && (
        <>
          <Text className="grow truncate" variant="s2" weight="semi-bold">
            {chatFilter === "unread" ? "Chat · Unread" : "Chat"}
          </Text>
          {/* Third Room #456: filter the list to chats with unread messages. */}
          <DropdownMenu
            content={
              <>
                <DropdownMenuItem onSelect={() => setChatFilter("all")}>
                  {chatFilter === "all" ? "✓ " : ""}All Chats
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setChatFilter("unread")}>
                  {chatFilter === "unread" ? "✓ " : ""}Unread Only
                </DropdownMenuItem>
              </>
            }
          >
            <IconButton label="Filter" iconSrc={FilterIC} variant={chatFilter === "unread" ? "primary" : undefined} />
          </DropdownMenu>
          <Dialog open={openJoin} onOpenChange={setJoinOpen}>
            <JoinWithAliasDialog requestClose={closeJoinDialog} />
          </Dialog>
          <Dialog open={open} onOpenChange={setOpen}>
            <DmDialog requestClose={closeDialog} />
          </Dialog>
          <Dialog open={create.open} onOpenChange={create.setOpen}>
            <CreateRoomDialog requestClose={create.closeDialog} />
          </Dialog>
          <DropdownMenu
            content={
              <>
                <DropdownMenuItem onSelect={openDialog}>Direct Message</DropdownMenuItem>
                <DropdownMenuItem onSelect={create.openDialog}>Create Room</DropdownMenuItem>
                <DropdownMenuItem onSelect={openJoinDialog}>Join with Alias</DropdownMenuItem>
              </>
            }
          >
            <IconButton label="Add" iconSrc={AddIC} />
          </DropdownMenu>
        </>
      )}
      {sidebarTab === SidebarTab.Notifications && (
        <>
          <Text className="grow truncate" variant="s2" weight="semi-bold">
            Notifications
          </Text>
        </>
      )}
    </header>
  );
}
