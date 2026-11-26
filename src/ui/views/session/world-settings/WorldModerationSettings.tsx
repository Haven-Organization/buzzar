/**
 * Buzzar: World Settings → Moderation → the ban lists this world follows (src/matrix/policyLists.ts). Saved at once
 * in the world's `software.haven.world.moderation` event; every visitor's Buzzar then holds back anyone those lists
 * ban.
 */
import { FormEvent, useEffect, useState } from "react";

import { Room } from "../../../../matrix";
import {
  MAX_POLICY_ROOMS,
  parseWorldModeration,
  PolicyRoomStatus,
  WORLD_MODERATION_EVENT,
} from "../../../../matrix/policyLists";
import { getHeldBack, onHeldBackChanged } from "../../../../engine/network/heldBack";
import { Button } from "../../../atoms/button/Button";
import { Input } from "../../../atoms/input/Input";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { useMatrix } from "../../../hooks/useMatrix";
import { useStateEvents } from "../../../hooks/useStateEvents";

/** How each followed list reads in the world you're in (undefined when you're not in this world). */
function useListStatus(roomId: string): PolicyRoomStatus[] | undefined {
  const [status, setStatus] = useState(() => getHeldBack(roomId)?.listStatus);
  useEffect(() => {
    setStatus(getHeldBack(roomId)?.listStatus);
    return onHeldBackChanged(() => setStatus(getHeldBack(roomId)?.listStatus));
  }, [roomId]);
  return status;
}

export function WorldModerationSettings({ room, canEdit }: { room: Room; canEdit: boolean }) {
  const { session } = useMatrix(true);
  const events = useStateEvents(room, WORLD_MODERATION_EVENT);
  const { policyRooms } = parseWorldModeration(events.get("")?.content);
  const status = useListStatus(room.id);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = async (next: string[]) => {
    const content = { ...(events.get("")?.content ?? {}), policy_rooms: next };
    await session.hsApi.sendState(room.id, WORLD_MODERATION_EVENT, "", content).response();
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const entry = draft.trim();
    setError(undefined);
    if (parseWorldModeration({ policy_rooms: [entry] }).policyRooms.length === 0) {
      setError("Enter a room address like #ban-list:example.org, or a room ID like !abc123:example.org.");
      return;
    }
    if (policyRooms.includes(entry)) {
      setError("This world already follows that list.");
      return;
    }
    if (policyRooms.length >= MAX_POLICY_ROOMS) {
      setError(`A world can follow up to ${MAX_POLICY_ROOMS} lists.`);
      return;
    }
    setBusy(true);
    try {
      // Visitors read the list without joining it, so it has to be readable by anyone.
      const client = session.client;
      const roomId = entry.startsWith("#") ? (await client.getRoomIdForAlias(entry)).room_id : entry;
      if (client.getRoom(roomId)?.getMyMembership() !== "join") await client.roomState(roomId);
      await save([...policyRooms, entry]);
      setDraft("");
    } catch (e) {
      const code = (e as { errcode?: string })?.errcode;
      setError(
        code === "M_FORBIDDEN"
          ? "Visitors can't read that list: only lists whose history anyone can read (as public ban lists do) work here."
          : code === "M_NOT_FOUND"
          ? "There's no room at that address."
          : e instanceof Error
          ? e.message
          : String(e)
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await save(policyRooms.filter((r) => r !== entry));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-column gap-md">
      <SettingTile label={<Label>Ban Lists</Label>}>
        <Text variant="b3" color="surface-low">
          Follow Matrix ban lists (policy lists, as Meowlnir, Draupnir and Mjolnir publish). Anyone they ban, by account
          or by server, is held back by every visitor&apos;s Buzzar as soon as the list changes: nobody sees their
          avatar or Things or hears them, and they don&apos;t see or hear anyone. No bot has to be running for this; a
          moderation bot or a moderator can still ban them from the world&apos;s room and chat.
        </Text>
        {policyRooms.length === 0 ? (
          <Text variant="b3">This world doesn&apos;t follow any ban lists.</Text>
        ) : (
          <div className="flex flex-column gap-xs">
            {policyRooms.map((entry) => {
              const s = status?.find((x) => x.room === entry);
              return (
                <div key={entry} className="flex items-center gap-sm">
                  <div className="grow flex flex-column">
                    <Text variant="b2" weight="medium">
                      {entry}
                    </Text>
                    {s && (
                      <Text variant="b3" color={s.error ? "danger" : "surface-low"}>
                        {s.error ?? `${s.rules} ban${s.rules === 1 ? "" : "s"}`}
                      </Text>
                    )}
                  </div>
                  {canEdit && (
                    <Button size="sm" fill="outline" variant="danger" onClick={() => remove(entry)} disabled={busy}>
                      Remove
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {canEdit && (
          <form className="flex items-center gap-sm" onSubmit={add}>
            <Input
              className="grow"
              placeholder="#ban-list:example.org"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
            <Button type="submit" disabled={busy || !draft.trim()}>
              {busy ? "Checking…" : "Follow"}
            </Button>
          </form>
        )}
        {error && (
          <Text variant="b3" color="danger">
            {error}
          </Text>
        )}
        {!canEdit && (
          <Text variant="b3" color="surface-low">
            You don&apos;t have permission to change which lists this world follows.
          </Text>
        )}
      </SettingTile>
    </div>
  );
}
