import { Session } from "@thirdroom/hydrogen-view-sdk";
import { useEffect, useState } from "react";

import { getSessionAuth, MatrixAuth } from "../utils/avatarMatrix";
import { aliasToRoomId, parseMatrixUri } from "../utils/matrixUtils";
import { useHydrogen } from "./useHydrogen";

/** Buzzar: what a portal leads to, shown on its tooltip before you step through (parity checklist §6). */
export interface PortalDestination {
  name?: string;
  topic?: string;
  /** People joined to the destination room. */
  members?: number;
  /** mxc:// or https:// picture: the world's scene preview, else the room avatar. */
  image?: string;
  /** A web page rather than a world. */
  web?: boolean;
}

const cache = new Map<string, Promise<PortalDestination | undefined>>();

/** The Matrix room summary (MSC3266, Matrix 1.15 `GET /v1/room_summary`): works for rooms you haven't joined. */
async function fetchRoomSummary(auth: MatrixAuth, target: string, via: string[]): Promise<PortalDestination | undefined> {
  const params = new URLSearchParams();
  for (const server of via) params.append("via", server);
  const query = params.toString();
  const res = await fetch(
    `${auth.homeserver.replace(/\/+$/, "")}/_matrix/client/v1/room_summary/${encodeURIComponent(target)}${
      query ? `?${query}` : ""
    }`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } }
  );
  if (!res.ok) return undefined;
  const summary = (await res.json()) as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  return {
    name: str(summary.name) ?? str(summary.canonical_alias),
    topic: str(summary.topic),
    members: typeof summary.num_joined_members === "number" ? summary.num_joined_members : undefined,
    image: str(summary.avatar_url),
  };
}

export async function resolveDestination(
  session: Session,
  getAuth: () => Promise<MatrixAuth | undefined>,
  uri: string
): Promise<PortalDestination | undefined> {
  const parsed = parseMatrixUri(uri);
  if (parsed instanceof URL) return { name: parsed.hostname, web: true };
  if (parsed.mxid1.startsWith("@")) return undefined;

  const target = parsed.mxid1;
  const roomId = target.startsWith("#") ? aliasToRoomId(session.rooms, target) : target;
  const room = roomId ? session.rooms.get(roomId) : undefined;
  if (room) {
    const world = await room.getStateEvent("org.matrix.msc3815.world").catch(() => undefined);
    const topic = await room.getStateEvent("m.room.topic").catch(() => undefined);
    const preview = world?.event?.content?.scene_preview_url;
    return {
      name: room.name ?? undefined,
      topic: typeof topic?.event?.content?.topic === "string" ? topic.event.content.topic : undefined,
      members: room.joinedMemberCount,
      image: typeof preview === "string" ? preview : room.avatarUrl ?? undefined,
    };
  }

  const auth = await getAuth();
  return auth ? fetchRoomSummary(auth, target, parsed.via) : undefined;
}

/** Looks up where a portal goes, once per address per session (failures are retried on the next look). */
export function usePortalDestination(uri: string | undefined): PortalDestination | undefined {
  const { session, platform, client } = useHydrogen(true);
  const [destination, setDestination] = useState<PortalDestination>();

  useEffect(() => {
    setDestination(undefined);
    if (!uri) return;
    let cancelled = false;
    let pending = cache.get(uri);
    if (!pending) {
      pending = resolveDestination(session, () => getSessionAuth(platform, client.sessionId), uri).catch(
        () => undefined
      );
      cache.set(uri, pending);
    }
    pending.then((result) => {
      if (!result) cache.delete(uri);
      if (!cancelled) setDestination(result);
    });
    return () => {
      cancelled = true;
    };
  }, [uri, session, platform, client]);

  return destination;
}
