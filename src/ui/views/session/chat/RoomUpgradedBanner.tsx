import { useState } from "react";
import { Room } from "@thirdroom/hydrogen-view-sdk";
import { useSetAtom } from "jotai";

import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { activeChatsAtom } from "../../../state/overlayChat";
import { getSessionAuth } from "../../../utils/avatarMatrix";
import { joinUpgradedRoom } from "../../../utils/roomUpgrade";
import "./RoomUpgradedBanner.css";

/**
 * Buzzar: replaces the composer in a room that has been upgraded, like Element: the old room is read-only and
 * the link joins (if needed) and opens the room that replaced it.
 */
export function RoomUpgradedBanner({ room }: { room: Room }) {
  const { session, platform, client } = useHydrogen(true);
  const setActiveChat = useSetAtom(activeChatsAtom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const continueThere = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      const next = await joinUpgradedRoom(session, auth, room);
      setActiveChat({ type: "OPEN", roomId: next.id });
      setActiveChat({ type: "CLOSE", roomId: room.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="RoomUpgradedBanner flex flex-column gap-xxs">
      <Text variant="b2" weight="semi-bold">
        This room has been replaced and is no longer active.
      </Text>
      <div className="flex items-center gap-xs">
        <Button size="sm" fill="none" disabled={busy} onClick={continueThere}>
          {busy ? "Joining…" : "The conversation continues here."}
        </Button>
        {error && (
          <Text variant="b3" color="danger">
            {error}
          </Text>
        )}
      </div>
    </div>
  );
}
