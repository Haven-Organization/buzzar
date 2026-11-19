/**
 * Buzzar: "Set as Home World" for any world you're in. Before switching, it warns about anything that makes the
 * world a less private home: it isn't private (anyone can join), you don't own or run it, or other people are in it.
 */
import { useEffect, useState } from "react";
import { Room } from "@thirdroom/hydrogen-view-sdk";
import { useSetAtom } from "jotai";

import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { IconButton } from "../../../atoms/button/IconButton";
import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { Dots } from "../../../atoms/loading/Dots";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { usePowerLevels } from "../../../hooks/usePowerLevels";
import { setHomeWorld } from "../../../hooks/useHomeWorld";
import { homeWorldAtom } from "../../../state/homeWorld";
import CrossIC from "../../../../../res/ic/cross.svg";

/** Reasons to think twice about making `room` your home (empty when there are none). */
export function useHomeWorldWarnings(room: Room): string[] | undefined {
  const { session } = useHydrogen(true);
  const { getPowerLevel } = usePowerLevels(room);
  const [joinRule, setJoinRule] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    room
      .getStateEvent("m.room.join_rules")
      .then((e: any) => !cancelled && setJoinRule(e?.event?.content?.join_rule ?? "invite"))
      .catch(() => !cancelled && setJoinRule("invite"));
    return () => {
      cancelled = true;
    };
  }, [room]);
  if (joinRule === undefined) return undefined;
  const warnings: string[] = [];
  if (joinRule !== "invite" && joinRule !== "private") {
    warnings.push(
      joinRule === "public"
        ? "It isn't private: anyone can find and join it."
        : `It isn't private (anyone ${joinRule === "knock" ? "can ask to join" : "who meets its rules can join"}).`
    );
  }
  if (getPowerLevel(session.userId) < 100) {
    warnings.push("You don't own or run it, so others decide what it looks like and who can come in.");
  }
  const others = room.joinedMemberCount - 1;
  if (others > 0) warnings.push(`${others} other ${others === 1 ? "person is" : "people are"} in it.`);
  return warnings;
}

export function SetHomeWorldDialog({ room, requestClose }: { room: Room; requestClose: () => void }) {
  const { session } = useHydrogen(true);
  const setHome = useSetAtom(homeWorldAtom);
  const warnings = useHomeWorldWarnings(room);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const confirm = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await setHomeWorld(session, room.id);
      setHome({ status: "ready", roomId: room.id });
      requestClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-column">
      <Header
        className="shrink-0"
        left={<HeaderTitle size="lg">Set as Home World</HeaderTitle>}
        right={<IconButton iconSrc={CrossIC} onClick={requestClose} label="Close" />}
      />
      <div className="flex flex-column gap-md" style={{ padding: "var(--sp-md)" }}>
        <Text variant="b2">
          Make <b>{room.name || "this world"}</b> your Home World? It's where Buzzar takes you when it starts.
        </Text>
        {!warnings ? (
          <Dots size="md" />
        ) : warnings.length > 0 ? (
          <div className="flex flex-column gap-xs">
            <Text variant="b2" weight="semi-bold" color="danger">
              Before you do:
            </Text>
            {warnings.map((w) => (
              <Text key={w} variant="b3">
                • {w}
              </Text>
            ))}
          </div>
        ) : null}
        {error && (
          <Text variant="b3" color="danger">
            {error}
          </Text>
        )}
        <div className="flex gap-sm justify-end">
          <Button fill="outline" onClick={requestClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={saving || !warnings} variant={warnings?.length ? "danger" : "primary"}>
            {saving ? "Saving…" : warnings?.length ? "Set Anyway" : "Set as Home World"}
          </Button>
        </div>
      </div>
    </div>
  );
}
