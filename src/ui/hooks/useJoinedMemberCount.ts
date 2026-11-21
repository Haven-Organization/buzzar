/**
 * Buzzar: how many people have joined a world you're in.
 *
 * Hydrogen only knows the count the homeserver sends in sync (`m.joined_member_count`), and some servers get it
 * wrong for good: Synapse's faster joins report just its own members (often 1) when you join a room hosted elsewhere
 * and may never send the corrected count (seen 2026-11-21). So this also asks the server for the
 * room's summary, which counts properly, and prefers that.
 */
import { useEffect, useState } from "react";

import { Room } from "../../matrix";
import { useHydrogen } from "./useHydrogen";
import { getSessionAuth } from "../utils/avatarMatrix";
import { fetchRoomSummary } from "../utils/worldDirectory";

/** Room ID → summary count and when it was fetched. */
const cache = new Map<string, { count: number; at: number }>();
const pending = new Map<string, Promise<number | undefined>>();
const MAX_AGE_MS = 60_000;

export function useJoinedMemberCount(room: Room | undefined): number {
  const { platform, client } = useHydrogen(true);
  const synced = room?.joinedMemberCount ?? 0;
  const [summary, setSummary] = useState<number | undefined>(() => (room ? cache.get(room.id)?.count : undefined));

  useEffect(() => {
    if (!room) return;
    const cached = cache.get(room.id);
    setSummary(cached?.count);
    if (cached && Date.now() - cached.at < MAX_AGE_MS) return;
    let cancelled = false;
    let request = pending.get(room.id);
    if (!request) {
      request = (async () => {
        const auth = await getSessionAuth(platform, client.sessionId);
        if (!auth) return undefined;
        const res = await fetchRoomSummary(auth, room.id);
        if (!res.ok) return undefined;
        const count = ((await res.json()) as { num_joined_members?: unknown }).num_joined_members;
        if (typeof count !== "number") return undefined;
        cache.set(room.id, { count, at: Date.now() });
        return count;
      })()
        .catch(() => undefined)
        .finally(() => pending.delete(room.id));
      pending.set(room.id, request);
    }
    request.then((count) => !cancelled && count !== undefined && setSummary(count));
    return () => {
      cancelled = true;
    };
    // Refetch when sync reports a change (someone joined or left).
  }, [room, synced, platform, client]);

  return summary ?? synced;
}
