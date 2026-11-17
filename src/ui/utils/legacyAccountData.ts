import type { MatrixAuth } from "./avatarMatrix";

/**
 * Buzzar: account data types renamed on 2026-11-17 to the `software.haven.world.*` prefix, mapped to their old name.
 */
export const LEGACY_ACCOUNT_DATA_TYPES: Record<string, string> = {
  "software.haven.world.avatars": "software.haven.avatars",
  "software.haven.world.script_grants": "software.haven.script_grants",
  "software.haven.world.explore_servers": "software.haven.explore_servers",
  "software.haven.world.space": "software.haven.space",
};

function accountDataUrl(auth: MatrixAuth, userId: string, type: string) {
  return `${auth.homeserver.replace(/\/+$/, "")}/_matrix/client/v3/user/${encodeURIComponent(
    userId
  )}/account_data/${encodeURIComponent(type)}`;
}

function put(auth: MatrixAuth, userId: string, type: string, content: unknown) {
  return fetch(accountDataUrl(auth, userId, type), {
    method: "PUT",
    headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(content),
  });
}

/**
 * Reads account data `type`. If it doesn't exist yet but the old name has content, moves that content to the new
 * name and empties the old one (account data can't be deleted), so it's only migrated once. Returns the response
 * for the new name: 404 when neither exists. Account data is private to the user, so moving it changes nothing
 * anyone else sees.
 */
export async function getAccountData(auth: MatrixAuth, userId: string, type: string): Promise<Response> {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  const res = await fetch(accountDataUrl(auth, userId, type), { headers });
  const legacyType = LEGACY_ACCOUNT_DATA_TYPES[type];
  if (res.status !== 404 || !legacyType) return res;

  const legacy = await fetch(accountDataUrl(auth, userId, legacyType), { headers });
  if (!legacy.ok) return res;
  const content = (await legacy.json().catch(() => undefined)) as Record<string, unknown> | undefined;
  if (!content || typeof content !== "object" || Object.keys(content).length === 0) return res;

  try {
    const saved = await put(auth, userId, type, content);
    if (saved.ok) await put(auth, userId, legacyType, {});
  } catch (error) {
    console.warn(`Couldn't move ${legacyType} to ${type}`, error);
  }
  return new Response(JSON.stringify(content), { status: 200, headers: { "Content-Type": "application/json" } });
}
