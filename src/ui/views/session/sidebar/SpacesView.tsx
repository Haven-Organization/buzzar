import { useAtom } from "jotai";

import { SidebarTab } from "../../components/sidebar-tab/SidebarTab";
import PlanetIC from "../../../../../res/ic/planet.svg";
import PeoplesIC from "../../../../../res/ic/peoples.svg";
import ChatIC from "../../../../../res/ic/chat.svg";
import AvatarIC from "../../../../../res/ic/avatar.svg";
import BoxIC from "../../../../../res/ic/box-3d.svg";
import NotificationIC from "../../../../../res/ic/notification.svg";
import { useMatrix } from "../../../hooks/useMatrix";
import { BadgeWrapper } from "../../../atoms/badge/BadgeWrapper";
import { NotificationBadge } from "../../../atoms/badge/NotificationBadge";
import { useInviteList } from "../../../hooks/useInviteList";
import { useUnreadNotificationCount } from "../../../hooks/useMatrixNotifications";
import { UserMenu } from "../menus/UserMenu";
import "./SpacesView.css";
import { RoomTypes, useRoomsOfType } from "../../../hooks/useRoomsOfType";
import { sidebarTabAtom, SidebarTab as SidebarTabEnum } from "../../../state/sidebarTab";
import { OverlayWindow, overlayWindowAtom } from "../../../state/overlayWindow";

export function SpacesView() {
  const { session } = useMatrix(true);
  const invites = useInviteList(session);
  const [rooms] = useRoomsOfType(session, RoomTypes.Room);
  const [directs] = useRoomsOfType(session, RoomTypes.Direct);
  const [sidebarTab, setSidebarTab] = useAtom(sidebarTabAtom);
  const [overlayWindow, setOverlayWindow] = useAtom(overlayWindowAtom);

  // Invites wait at the top of Chat, so they count toward its badge; the bell counts unread notifications.
  const chatNotifCount =
    [...rooms, ...directs].reduce((total, room) => total + room.notificationCount, 0) + invites.length;
  const unreadNotifications = useUnreadNotificationCount(session);

  return (
    <div className="SpacesView flex flex-column">
      <div className="grow flex flex-column items-center gap-xs">
        <SidebarTab
          onClick={() => setOverlayWindow({ type: OverlayWindow.Worlds })}
          isActive={overlayWindow.type === OverlayWindow.Worlds}
          name="Worlds"
          iconSrc={PlanetIC}
          variant="surface-low"
        />
        <SidebarTab
          onClick={() => setOverlayWindow({ type: OverlayWindow.Avatars })}
          isActive={overlayWindow.type === OverlayWindow.Avatars}
          name="Avatars"
          iconSrc={AvatarIC}
          variant="surface-low"
        />
        <SidebarTab
          onClick={() => setOverlayWindow({ type: OverlayWindow.Things })}
          isActive={overlayWindow.type === OverlayWindow.Things}
          name="Things"
          iconSrc={BoxIC}
          variant="surface-low"
        />
        <SidebarTab
          onClick={() => setOverlayWindow({ type: OverlayWindow.People })}
          isActive={overlayWindow.type === OverlayWindow.People}
          name="People"
          iconSrc={PeoplesIC}
          variant="surface-low"
        />
        <BadgeWrapper badge={chatNotifCount > 0 && <NotificationBadge content={chatNotifCount} />}>
          <SidebarTab
            onClick={() => setSidebarTab(SidebarTabEnum.Chat)}
            isActive={sidebarTab === SidebarTabEnum.Chat && overlayWindow.type === OverlayWindow.None}
            name="Chat"
            iconSrc={ChatIC}
            variant="surface-low"
          />
        </BadgeWrapper>
        <BadgeWrapper
          badge={unreadNotifications > 0 ? <NotificationBadge content={unreadNotifications} /> : undefined}
        >
          <SidebarTab
            onClick={() => setSidebarTab(SidebarTabEnum.Notifications)}
            isActive={sidebarTab === SidebarTabEnum.Notifications && overlayWindow.type === OverlayWindow.None}
            name="Notifications"
            iconSrc={NotificationIC}
            variant="surface-low"
          />
        </BadgeWrapper>
      </div>
      <div className="shrink-0 flex flex-column items-center gap-xs">
        <UserMenu />
      </div>
    </div>
  );
}
