import { CSSProperties, ReactNode } from "react";
import { useMatch } from "react-router-dom";
import { useAtom, useSetAtom } from "jotai";

import { Session } from "../../../../matrix";
import { Text } from "../../../atoms/text/Text";
import { useMatrix } from "../../../hooks/useMatrix";
import { useResumePlay } from "../../../hooks/useResumePlay";
import "./StatusBar.css";
import { useWorldPath } from "../../../hooks/useWorld";
import { worldChatVisibilityAtom } from "../../../state/worldChatVisibility";
import { overlayVisibilityAtom } from "../../../state/overlayVisibility";
import { sidebarTabAtom, SidebarTab } from "../../../state/sidebarTab";
import { Icon } from "../../../atoms/icon/Icon";
import { NotificationBadge } from "../../../atoms/badge/NotificationBadge";
import { useInvitesOfType } from "../../../hooks/useInvitesOfType";
import { RoomTypes } from "../../../hooks/useRoomsOfType";
import NotificationIC from "../../../../../res/ic/notification.svg";

function OverlayButton({
  style,
  children,
  onClick,
}: {
  style?: CSSProperties;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="OverlayButton" style={style} onClick={onClick} type="button">
      {children}
    </button>
  );
}

/**
 * Buzzar: the bell counts what the Notifications panel lists (pending world/room/DM invites), not the total
 * unread messages across every Matrix chat room (which showed e.g. "17719 Notifications").
 */
function useNotificationCount(session: Session) {
  const [worldInvites] = useInvitesOfType(session, RoomTypes.World);
  const [roomInvites] = useInvitesOfType(session, RoomTypes.Room);
  const [dmInvites] = useInvitesOfType(session, RoomTypes.Direct);
  return worldInvites.length + roomInvites.length + dmInvites.length;
}

export function NotificationButton({ onClick }: { onClick: () => void }) {
  const { session } = useMatrix(true);
  const count = useNotificationCount(session);
  const label = count > 0 ? `${count} notification${count === 1 ? "" : "s"}` : "Notifications";

  return (
    <OverlayButton onClick={onClick}>
      <span className="StatusBar__bell" aria-label={label} title={label}>
        <Icon src={NotificationIC} color="world" size="sm" />
        {count > 0 && (
          <NotificationBadge className="StatusBar__bell-badge" variant="danger" content={count > 99 ? "99+" : count} />
        )}
      </span>
    </OverlayButton>
  );
}

export function StatusBar() {
  const { session } = useMatrix(true);
  const [overlayVisible, setOverlayVisibility] = useAtom(overlayVisibilityAtom);
  const setWorldChatVisibility = useSetAtom(worldChatVisibilityAtom);
  const setSidebarTab = useSetAtom(sidebarTabAtom);

  const homeMatch = useMatch({ path: "/", end: true });
  const isHome = homeMatch !== null;
  const [knownWorldId] = useWorldPath();
  const world = knownWorldId ? session.rooms.get(knownWorldId) : undefined;

  // Buzzar: clicking "Close Overlay" is a user gesture, so it takes the mouse back for play too.
  const resumePlay = useResumePlay();
  const openOverlay = () => {
    if (overlayVisible) {
      resumePlay();
      setOverlayVisibility(false);
    } else {
      document.exitPointerLock();
      setWorldChatVisibility(false);
      setOverlayVisibility(true);
    }
  };

  const openNotifications = () => {
    if (overlayVisible) {
      resumePlay();
      setOverlayVisibility(false);
    } else {
      document.exitPointerLock();
      setWorldChatVisibility(false);
      setOverlayVisibility(true);
      setSidebarTab(SidebarTab.Notifications);
    }
  };

  return (
    <div className="StatusBar shrink-0 flex items-center">
      <div className="StatusBar__left grow basis-0 flex">
        {knownWorldId && overlayVisible && (
          // Buzzar: in the world, the menu button and its Tab key sit with the other controls at the bottom right,
          // and the rest of the keys are in the "/" help. Those controls are behind the overlay, so closing it is
          // offered here.
          <OverlayButton style={{ paddingLeft: "var(--sp-xxs)" }} onClick={openOverlay}>
            <Text
              color="world"
              weight="medium"
              variant="b3"
              style={{
                padding: "0 3px",
                borderRadius: "var(--br-xxs)",
                border: "1px solid var(--bg-world-border)",
              }}
            >
              TAB
            </Text>
            <Text className="flex items-center" color="world" variant="b3">
              Close Overlay
            </Text>
          </OverlayButton>
        )}
      </div>
      <div className="StatusBar__center">
        <Text color="world" weight="semi-bold">
          {isHome ? "Home" : world?.name ?? world?.canonicalAlias ?? "Unknown"}
        </Text>
      </div>
      <div className="StatusBar__right grow basis-0 flex justify-end gap-xxs">
        {knownWorldId && <NotificationButton onClick={openNotifications} />}
      </div>
    </div>
  );
}
