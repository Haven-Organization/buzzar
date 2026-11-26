/**
 * Buzzar: World Settings → Moderation (src/matrix/policyLists.ts), saved at once:
 * - the world's own bans: accounts and servers banned in the world room itself (standard `m.policy.rule.*` events);
 * - the other ban lists it follows (`software.haven.world.moderation`).
 * Every visitor's Buzzar holds back anyone they ban.
 */
import { FormEvent, useEffect, useState } from "react";

import { Room } from "../../../../matrix";
import {
  globMatches,
  MAX_POLICY_ROOMS,
  serverOf,
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

const USER_RULE = "m.policy.rule.user";
const SERVER_RULE = "m.policy.rule.server";

/** A ban entry typed in: an account (`@name:server`, globs allowed) or a server name (globs allowed). */
export function parseBanEntity(text: string): { kind: "user" | "server"; entity: string } | undefined {
  const entity = text.trim();
  if (!entity || entity.length > 255 || /\s/.test(entity)) return undefined;
  if (entity.startsWith("@")) return /^@[^:]+:.+$/.test(entity) ? { kind: "user", entity } : undefined;
  return /^[^@:/]+(:\d+)?$/.test(entity) ? { kind: "server", entity } : undefined;
}

/** The world room's own bans: ban accounts or whole servers here, or lift a ban. */
function WorldBans({ room, canEdit }: { room: Room; canEdit: boolean }) {
  const { session } = useMatrix(true);
  const userRules = useStateEvents(room, USER_RULE);
  const serverRules = useStateEvents(room, SERVER_RULE);
  const rules = [
    ...[...userRules].map(([key, event]) => ({ type: USER_RULE, key, content: event.content })),
    ...[...serverRules].map(([key, event]) => ({ type: SERVER_RULE, key, content: event.content })),
  ].filter((r) => typeof r.content?.entity === "string" && r.content?.recommendation === "m.ban");

  const [entity, setEntity] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const ban = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    const parsed = parseBanEntity(entity);
    if (!parsed) {
      setError("Enter an account like @name:example.org, or a server like example.org (* and ? match anything).");
      return;
    }
    if (parsed.kind === "user" && globMatches(parsed.entity, session.userId)) {
      setError("That would ban you.");
      return;
    }
    if (parsed.kind === "server" && globMatches(parsed.entity, serverOf(session.userId))) {
      setError("That would ban your own server, and you with it.");
      return;
    }
    setBusy(true);
    try {
      const content = { entity: parsed.entity, recommendation: "m.ban", reason: reason.trim() || undefined };
      await session.hsApi
        .sendState(room.id, parsed.kind === "user" ? USER_RULE : SERVER_RULE, `rule:${parsed.entity}`, content)
        .response();
      setEntity("");
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const lift = async (type: string, key: string) => {
    setBusy(true);
    setError(undefined);
    try {
      // A rule is removed by emptying its state event.
      await session.hsApi.sendState(room.id, type, key, {}).response();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingTile label={<Label>Banned Accounts and Servers</Label>}>
      <Text variant="b3" color="surface-low">
        Every visitor&apos;s Buzzar holds these back at once: nobody sees their avatar or Things or hears them, and they
        don&apos;t see or hear anyone. They&apos;re standard Matrix ban rules kept in this world&apos;s room, so
        moderation bots (Meowlnir, Draupnir) can follow this world as a ban list too. To also remove someone from the
        world&apos;s room and chat, use Ban in the People list.
      </Text>
      {rules.length === 0 ? (
        <Text variant="b3">Nobody is banned here.</Text>
      ) : (
        <div className="flex flex-column gap-xs">
          {rules.map((rule) => (
            <div key={rule.type + rule.key} className="flex items-center gap-sm">
              <div className="grow flex flex-column">
                <Text variant="b2" weight="medium" className="truncate">
                  {rule.content.entity}
                  {rule.type === SERVER_RULE ? " (server)" : ""}
                </Text>
                {typeof rule.content.reason === "string" && rule.content.reason && (
                  <Text variant="b3" color="surface-low" className="truncate">
                    {rule.content.reason}
                  </Text>
                )}
              </div>
              {canEdit && (
                <Button size="sm" fill="outline" onClick={() => lift(rule.type, rule.key)} disabled={busy}>
                  Lift Ban
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <form className="flex flex-column gap-xs" onSubmit={ban}>
          <div className="flex items-center gap-sm">
            <Input
              className="grow"
              placeholder="@name:example.org or example.org"
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              disabled={busy}
            />
            <Button type="submit" variant="danger" disabled={busy || !entity.trim()}>
              Ban
            </Button>
          </div>
          <Input
            placeholder="Reason (optional, visible to everyone in the world)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
        </form>
      )}
      {error && (
        <Text variant="b3" color="danger">
          {error}
        </Text>
      )}
      {!canEdit && (
        <Text variant="b3" color="surface-low">
          You don&apos;t have permission to ban people here.
        </Text>
      )}
    </SettingTile>
  );
}

export function WorldModerationSettings({ room, canEdit, canBan }: { room: Room; canEdit: boolean; canBan: boolean }) {
  const { session } = useMatrix(true);
  const events = useStateEvents(room, WORLD_MODERATION_EVENT);
  const { policyRooms } = parseWorldModeration(events.get("")?.content);
  const status = useListStatus(room.id);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

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
    setNotice(undefined);
    try {
      // Visitors read the list without joining it, which only works if anyone may read its history.
      const client = session.client;
      const roomId = entry.startsWith("#") ? (await client.getRoomIdForAlias(entry)).room_id : entry;
      let readable: boolean;
      const joined = client.getRoom(roomId);
      if (joined?.getMyMembership() === "join") {
        const visibility = joined.currentState.getStateEvents("m.room.history_visibility", "")?.getContent();
        readable = visibility?.history_visibility === "world_readable";
      } else {
        readable = await client.roomState(roomId).then(
          () => true,
          (e: { errcode?: string }) => {
            if (e?.errcode === "M_FORBIDDEN") return false;
            throw e;
          }
        );
      }
      await save([...policyRooms, entry]);
      setDraft("");
      if (!readable) {
        setNotice(
          "Followed, but visitors can't read this list without joining it (most big public lists are like that), so " +
            "its bans don't apply on their own. A moderation bot that copies them into this world's bans makes them apply."
        );
      }
    } catch (e) {
      const code = (e as { errcode?: string })?.errcode;
      setError(
        code === "M_NOT_FOUND" ? "There's no room at that address." : e instanceof Error ? e.message : String(e)
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
      <WorldBans room={room} canEdit={canBan} />
      <SettingTile label={<Label>Ban Lists</Label>}>
        <Text variant="b3" color="surface-low">
          Follow other Matrix ban lists too (policy lists, as Meowlnir, Draupnir and Mjolnir publish). Lists anyone can
          read apply straight away, like the bans above. Most big public lists can only be read by joining them;
          visitors don&apos;t join, so their bans apply once a moderation bot copies them into this world&apos;s bans.
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
        {notice && <Text variant="b3">{notice}</Text>}
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
