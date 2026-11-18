/**
 * Buzzar: the visitor's world-script settings (this browser) and their remembered "read the chat" grants
 * (account data, so they follow them to other devices).
 */
import { MatrixAuth } from "./avatarMatrix";
import { getAccountData } from "./legacyAccountData";

export const RUN_SCRIPTS_KEY = "buzzar.scripts.enabled";
export const WEB_SCRIPTS_KEY = "buzzar.scripts.allowWeb";

function readBool(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value) === true;
  } catch {
    return fallback;
  }
}

/** Run world scripts at all (default on). Off = every world loads without its script. */
export const runWorldScripts = () => readBool(RUN_SCRIPTS_KEY, true);
/** Allow scripts hosted on web addresses (default off: fetching them reveals your IP to that site). */
export const allowWebScripts = () => readBool(WEB_SCRIPTS_KEY, false);

/**
 * Buzzar: "Enter Without Script" (a world's ⋯ menu) skips the script for that one visit only. Nothing is stored, so a
 * world never stays without its script by accident: the next ordinary Enter runs it again.
 */
let enterWithoutScriptRoomId: string | undefined;

/** Call just before entering `roomId` from "Enter Without Script"; any other entry clears it. */
export function setEnterWithoutScript(roomId: string | undefined) {
  enterWithoutScriptRoomId = roomId;
}

/** Whether this entry into `roomId` should skip the script. Reading it uses it up. */
export function takeEnterWithoutScript(roomId: string) {
  const skip = enterWithoutScriptRoomId === roomId;
  enterWithoutScriptRoomId = undefined;
  return skip;
}

// The per-world "turned off" list this replaced lived in localStorage; drop it so it can't linger.
try {
  localStorage.removeItem("buzzar.scripts.blockedWorlds");
} catch {
  // storage unavailable
}

export type ScriptPolicy = { run: true } | { run: false; reason: "disabled" | "web" | "skipped" };

/** Whether to run a world's script_url under the visitor's settings (`skipped`: entered without script). */
export function scriptPolicy(scriptUrl: string, skipped = false): ScriptPolicy {
  if (!runWorldScripts()) return { run: false, reason: "disabled" };
  if (skipped) return { run: false, reason: "skipped" };
  if (!scriptUrl.startsWith("mxc://") && !allowWebScripts()) return { run: false, reason: "web" };
  return { run: true };
}

// --- Remembered grants -------------------------------------------------------------------------------------------

export const SCRIPT_GRANTS_TYPE = "software.haven.world.script_grants";

export interface ScriptGrant {
  /** The script_url the grant is for: a new script asks again. */
  script: string;
  /** Read the world chat as it happens. */
  receive: boolean;
  granted_ts: number;
}

export type ScriptGrants = Record<string, ScriptGrant>;

function grantsUrl(auth: MatrixAuth, userId: string) {
  return `${auth.homeserver.replace(/\/+$/, "")}/_matrix/client/v3/user/${encodeURIComponent(
    userId
  )}/account_data/${SCRIPT_GRANTS_TYPE}`;
}

export async function fetchScriptGrants(auth: MatrixAuth, userId: string): Promise<ScriptGrants> {
  const res = await getAccountData(auth, userId, SCRIPT_GRANTS_TYPE);
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`Couldn't load your script permissions: ${res.status}`);
  const body = (await res.json()) as { grants?: unknown };
  const grants: ScriptGrants = {};
  if (body.grants && typeof body.grants === "object") {
    for (const [roomId, value] of Object.entries(body.grants as Record<string, unknown>)) {
      const grant = value as Partial<ScriptGrant>;
      if (typeof grant?.script === "string" && typeof grant.receive === "boolean") {
        grants[roomId] = {
          script: grant.script,
          receive: grant.receive,
          granted_ts: typeof grant.granted_ts === "number" ? grant.granted_ts : 0,
        };
      }
    }
  }
  return grants;
}

export async function saveScriptGrants(auth: MatrixAuth, userId: string, grants: ScriptGrants) {
  const res = await fetch(grantsUrl(auth, userId), {
    method: "PUT",
    headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ grants }),
  });
  if (!res.ok) throw new Error(`Couldn't save your script permissions: ${res.status}`);
}
