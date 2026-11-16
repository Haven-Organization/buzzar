/**
 * Buzzar: the People screen. "In This World" is the member list of the world you're in (what the P key used to open
 * as a popup); "Friends" are the people you have direct messages with.
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";

import { Content } from "../../../atoms/content/Content";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { Icon } from "../../../atoms/icon/Icon";
import { IconButton } from "../../../atoms/button/IconButton";
import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { Scroll } from "../../../atoms/scroll/Scroll";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { Avatar } from "../../../atoms/avatar/Avatar";
import { SegmentControl } from "../../../atoms/segment-control/SegmentControl";
import { SegmentControlItem } from "../../../atoms/segment-control/SegmentControlItem";
import { Window } from "../../components/window/Window";
import { MemberTile } from "../../components/member-tile/MemberTile";
import { MemberListDialog } from "../dialogs/MemberListDialog";
import { DmDialog } from "../dialogs/DmDialog";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { useRoom } from "../../../hooks/useRoom";
import { useDialog } from "../../../hooks/useDialog";
import { useRoomsOfType, RoomTypes } from "../../../hooks/useRoomsOfType";
import { getAvatarHttpUrl, getIdentifierColorNumber } from "../../../utils/avatar";
import { worldAtom } from "../../../state/world";
import { activeChatsAtom } from "../../../state/overlayChat";
import { OverlayWindow, overlayWindowAtom, PeopleTab } from "../../../state/overlayWindow";
import { sidebarTabAtom, SidebarTab } from "../../../state/sidebarTab";
import PeoplesIC from "../../../../../res/ic/peoples.svg";
import AddUserIC from "../../../../../res/ic/add-user.svg";

export function PeopleView() {
  const { session } = useHydrogen(true);
  const [overlayWindow, setOverlayWindow] = useAtom(overlayWindowAtom);
  const { worldId, entered } = useAtomValue(worldAtom);
  const world = useRoom(session, entered ? worldId : undefined);
  const dm = useDialog(false);

  const requested = overlayWindow.type === OverlayWindow.People ? overlayWindow.tab : undefined;
  const tab: PeopleTab = world ? requested ?? "world" : "friends";
  const setTab = (value: PeopleTab) => setOverlayWindow({ type: OverlayWindow.People, tab: value });

  return (
    <Window className="TileScreen">
      <Content
        top={
          <Header
            left={
              <HeaderTitle icon={<Icon color="surface" className="shrink-0" src={PeoplesIC} />}>People</HeaderTitle>
            }
            right={
              <>
                <Dialog open={dm.open} onOpenChange={dm.setOpen}>
                  <DmDialog requestClose={dm.closeDialog} />
                </Dialog>
                <IconButton label="Direct Message" iconSrc={AddUserIC} onClick={dm.openDialog} />
              </>
            }
          />
        }
      >
        <div className="TileScreen__bar flex items-center gap-sm">
          <SegmentControl>
            {world ? (
              <SegmentControlItem value="world" isSelected={tab === "world"} onSelect={setTab}>
                In This World
              </SegmentControlItem>
            ) : (
              <></>
            )}
            <SegmentControlItem value="friends" isSelected={tab === "friends"} onSelect={setTab}>
              Friends
            </SegmentControlItem>
          </SegmentControl>
          {tab === "world" && world && (
            <Text variant="b3" color="surface-low">
              {world.name || "This world"}
            </Text>
          )}
        </div>
        {tab === "world" && world ? (
          <div className="TileScreen__members flex flex-column">
            <MemberListDialog room={world} embedded />
          </div>
        ) : (
          <Friends onDirectMessage={dm.openDialog} />
        )}
      </Content>
    </Window>
  );
}

function Friends({ onDirectMessage }: { onDirectMessage: () => void }) {
  const { session, platform } = useHydrogen(true);
  const [directs] = useRoomsOfType(session, RoomTypes.Direct);
  const setActiveChat = useSetAtom(activeChatsAtom);
  const setSidebarTab = useSetAtom(sidebarTabAtom);

  const openChat = (roomId: string) => {
    setSidebarTab(SidebarTab.Chat);
    setActiveChat({ type: "OPEN", roomId });
  };

  return (
    <Scroll type="hover">
      <div className="TileScreen__body flex flex-column gap-xs">
        {directs.length === 0 ? (
          <div className="flex flex-column items-start gap-sm">
            <Text variant="b2">You don't have any friends here yet. Start a direct message with someone.</Text>
            <Button onClick={onDirectMessage}>Direct Message</Button>
          </div>
        ) : (
          directs.map((room) => {
            const name = room.name || "Empty room";
            return (
              <MemberTile
                key={room.id}
                avatar={
                  <Avatar
                    shape="circle"
                    name={name}
                    imageSrc={
                      room.avatarUrl
                        ? getAvatarHttpUrl(room.avatarUrl, 40, platform, session.mediaRepository) ?? undefined
                        : undefined
                    }
                    bgColor={`var(--usercolor${getIdentifierColorNumber(room.id)})`}
                  />
                }
                content={
                  <Text className="truncate" weight="medium">
                    {name}
                  </Text>
                }
                options={
                  <Button size="sm" fill="outline" onClick={() => openChat(room.id)}>
                    Message
                  </Button>
                }
              />
            );
          })
        )}
      </div>
    </Scroll>
  );
}
