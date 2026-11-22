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
import { useUnreadNotificationCount } from "../../../hooks/useMatrixNotifications";
import NotificationIC from "../../../../../res/ic/notification.svg";
import { useLocalStorage } from "../../../hooks/useLocalStorage";

/** Buzzar: whether the world's name shows at the top (Settings → Graphics). Off by default. */
export const LOCAL_STORAGE_SHOW_WORLD_NAME = "buzzar.showWorldName";

function OverlayButton({
  style,
  children,
  onClick,
  label,
}: {
  style?: CSSProperties;
  children: ReactNode;
  onClick: () => void;
  /** Buzzar (Third Room #399): the button's name for screen readers when its content isn't text. */
  label?: string;
}) {
  return (
    <button className="OverlayButton" style={style} onClick={onClick} type="button" aria-label={label} title={label}>
      {children}
    </button>
  );
}

/**
 * Buzzar: the bell counts the Notifications panel's unread notifications (mentions and other messages your push
 * rules notify for), not the total unread messages across every chat room (which showed e.g. "17719").
 */
function useNotificationCount(session: Session) {
  return useUnreadNotificationCount(session);
}

export function NotificationButton({ onClick }: { onClick: () => void }) {
  const { session } = useMatrix(true);
  const count = useNotificationCount(session);
  const label = count > 0 ? `${count} notification${count === 1 ? "" : "s"}` : "Notifications";

  return (
    <OverlayButton onClick={onClick} label={label}>
      <span className="StatusBar__bell" aria-hidden>
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
  const [showWorldName] = useLocalStorage(LOCAL_STORAGE_SHOW_WORLD_NAME, false);

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
        {showWorldName && (
          <Text color="world" weight="semi-bold">
            {isHome ? "Home" : world?.name ?? world?.canonicalAlias ?? "Unknown"}
          </Text>
        )}
      </div>
      <div className="StatusBar__right grow basis-0 flex justify-end gap-xxs">
        {knownWorldId && <NotificationButton onClick={openNotifications} />}
      </div>
    </div>
  );
}
