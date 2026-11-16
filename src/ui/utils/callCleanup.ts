/**
 * Buzzar: remove this device from the world calls it isn't in any more.
 *
 * Leaving a world leaves its call, but a reload or closing the app doesn't get the chance, so the device stayed
 * listed in the old world's call (org.matrix.msc3401.call.member) until it expired an hour later: other people saw
 * you in several worlds at once. On entering a world we drop our device from every other room's call state.
 */
import { MatrixAuth } from "./avatarMatrix";

const CALL_MEMBER = "org.matrix.msc3401.call.member";

type CallMemberContent = { "m.calls"?: { "m.devices"?: { device_id?: string }[] }[] } & Record<string, unknown>;

async function api(auth: MatrixAuth, method: string, path: string, body?: unknown) {
  return fetch(`${auth.homeserver.replace(/\/+$/, "")}/_matrix/client/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${auth.accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Removes `deviceId` from the call state of each room in `roomIds` except `keepRoomId`. Returns rooms changed. */
export async function removeStaleCallMemberships(
  auth: MatrixAuth,
  userId: string,
  deviceId: string,
  roomIds: string[],
  keepRoomId?: string
) {
  const changed: string[] = [];
  for (const roomId of roomIds) {
    if (roomId === keepRoomId) continue;
    const path = `/rooms/${encodeURIComponent(roomId)}/state/${CALL_MEMBER}/${encodeURIComponent(userId)}`;
    try {
      const res = await api(auth, "GET", path);
      if (!res.ok) continue;
      const content = (await res.json()) as CallMemberContent;
      const calls = content["m.calls"] ?? [];
      const listed = calls.some((call) => call["m.devices"]?.some((device) => device.device_id === deviceId));
      if (!listed) continue;
      const nextCalls = calls
        .map((call) => ({ ...call, "m.devices": (call["m.devices"] ?? []).filter((d) => d.device_id !== deviceId) }))
        .filter((call) => call["m.devices"].length > 0);
      const put = await api(auth, "PUT", path, { ...content, "m.calls": nextCalls });
      if (put.ok) changed.push(roomId);
    } catch {
      // best effort
    }
  }
  return changed;
}
