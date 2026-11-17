import { useAtomValue } from "jotai";

import AddIC from "../../../../../res/ic/add.svg";
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

  return (
    <header className="RoomListHeader shrink-0 flex items-center gap-xs">
      {sidebarTab === SidebarTab.Chat && (
        <>
          <Text className="grow truncate" variant="s2" weight="semi-bold">
            Chat
          </Text>
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
