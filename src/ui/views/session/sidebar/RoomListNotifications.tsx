import { useSetAtom } from "jotai";
import classNames from "classnames";

import { useMatrix } from "../../../hooks/useMatrix";
import { getIdentifierColorNumber, getAvatarHttpUrl } from "../../../utils/avatar";
import { Avatar } from "../../../atoms/avatar/Avatar";
import { Text } from "../../../atoms/text/Text";
import { Button } from "../../../atoms/button/Button";
import { EmptyState } from "../../components/empty-state/EmptyState";
import { activeChatsAtom } from "../../../state/overlayChat";
import {
  MatrixNotification,
  useMatrixNotifications,
  useRefreshNotificationsOnOpen,
} from "../../../hooks/useMatrixNotifications";
import "./RoomListNotifications.css";

function formatTime(ts: number) {
  const date = new Date(ts);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Buzzar: the Notifications panel lists your Matrix notifications (mentions, DMs, keywords: whatever your push rules
 * notify for), like Element's. Invites moved to the top of Chat.
 */
export function RoomListNotifications() {
  const { session, platform } = useMatrix(true);
  useRefreshNotificationsOnOpen(session);
  const { items, loading, error, nextToken, loadMore, refresh } = useMatrixNotifications(session);
  const setActiveChat = useSetAtom(activeChatsAtom);

  if (items.length === 0) {
    if (loading) return <EmptyState style={{ minHeight: "400px" }} heading="Loading…" text="" />;
    return (
      <EmptyState
        style={{ minHeight: "400px" }}
        heading={error ? "Couldn't Load Notifications" : "No Notifications"}
        text={error ?? "Mentions and other messages that notify you show up here."}
        actions={error ? <Button onClick={refresh}>Try Again</Button> : undefined}
      />
    );
  }

  const renderItem = (n: MatrixNotification) => (
    <button
      key={n.id}
      type="button"
      className={classNames("MatrixNotifications__item", { "MatrixNotifications__item--unread": !n.read })}
      onClick={() => setActiveChat({ type: "OPEN", roomId: n.roomId })}
    >
      <Avatar
        name={n.senderName}
        size="sm"
        shape="circle"
        className="shrink-0"
        bgColor={`var(--usercolor${getIdentifierColorNumber(n.senderId)})`}
        imageSrc={n.senderAvatarUrl ? getAvatarHttpUrl(n.senderAvatarUrl, 32, platform, session.mediaRepository) : undefined}
      />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="MatrixNotifications__head">
          <Text className="truncate" variant="b3" weight="semi-bold">
            {n.senderName}
          </Text>
          <Text className="truncate grow" variant="b3" color="surface-low">
            in {n.roomName}
          </Text>
          <Text className="shrink-0" variant="b3" color="surface-low">
            {formatTime(n.ts)}
          </Text>
        </div>
        <Text className="MatrixNotifications__body" variant="b3" weight={n.highlight ? "semi-bold" : undefined}>
          {n.body}
        </Text>
      </div>
    </button>
  );

  return (
    <div>
      {items.map(renderItem)}
      {nextToken && (
        <div className="MatrixNotifications__more">
          <Button variant="secondary" size="sm" onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : "Load More"}
          </Button>
        </div>
      )}
    </div>
  );
}
