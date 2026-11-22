import { useAtom, useAtomValue } from "jotai";

import AddIC from "../../../../../res/ic/add.svg";
import FilterIC from "../../../../../res/ic/filter.svg";
import DoneAllIC from "../../../../../res/ic/done-all.svg";
import { chatFilterAtom, ListFilter, notificationsFilterAtom } from "../../../state/chatFilter";
import { Tooltip } from "../../../atoms/tooltip/Tooltip";
import { useMatrix } from "../../../hooks/useMatrix";
import { useMatrixNotifications } from "../../../hooks/useMatrixNotifications";
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

function MarkAllReadButton() {
  const { session } = useMatrix(true);
  const { items, markAllRead } = useMatrixNotifications(session);
  const unread = items.some((n) => !n.read);
  return (
    <Tooltip content="Mark All Read">
      <IconButton label="Mark All Read" iconSrc={DoneAllIC} onClick={markAllRead} disabled={!unread} />
    </Tooltip>
  );
}

/** A filter button: everything, or only what's unread (`allLabel` names "everything"). */
function FilterButton({
  filter,
  setFilter,
  allLabel,
}: {
  filter: ListFilter;
  setFilter: (filter: ListFilter) => void;
  allLabel: string;
}) {
  return (
    <Tooltip content={filter === "unread" ? "Filter: Unread Only" : "Filter"}>
      <DropdownMenu
        content={
          <>
            <DropdownMenuItem onSelect={() => setFilter("all")}>
              {filter === "all" ? "✓ " : ""}
              {allLabel}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setFilter("unread")}>
              {filter === "unread" ? "✓ " : ""}Unread Only
            </DropdownMenuItem>
          </>
        }
      >
        <IconButton label="Filter" iconSrc={FilterIC} variant={filter === "unread" ? "primary" : undefined} />
      </DropdownMenu>
    </Tooltip>
  );
}

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
  const [notificationsFilter, setNotificationsFilter] = useAtom(notificationsFilterAtom);

  return (
    <header className="RoomListHeader shrink-0 flex items-center gap-xs">
      {sidebarTab === SidebarTab.Chat && (
        <>
          <Text className="grow truncate" variant="s2" weight="semi-bold">
            {chatFilter === "unread" ? "Chat · Unread" : "Chat"}
          </Text>
          {/* Third Room #456: filter the list to chats with unread messages. */}
          <FilterButton filter={chatFilter} setFilter={setChatFilter} allLabel="All Chats" />
          <Dialog open={openJoin} onOpenChange={setJoinOpen}>
            <JoinWithAliasDialog requestClose={closeJoinDialog} />
          </Dialog>
          <Dialog open={open} onOpenChange={setOpen}>
            <DmDialog requestClose={closeDialog} />
          </Dialog>
          <Dialog open={create.open} onOpenChange={create.setOpen}>
            <CreateRoomDialog requestClose={create.closeDialog} />
          </Dialog>
          <Tooltip content="New Chat or Room">
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
          </Tooltip>
        </>
      )}
      {sidebarTab === SidebarTab.Notifications && (
        <>
          <Text className="grow truncate" variant="s2" weight="semi-bold">
            {notificationsFilter === "unread" ? "Notifications · Unread" : "Notifications"}
          </Text>
          <FilterButton filter={notificationsFilter} setFilter={setNotificationsFilter} allLabel="All Notifications" />
          <MarkAllReadButton />
        </>
      )}
    </header>
  );
}
