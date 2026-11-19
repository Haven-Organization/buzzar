/**
 * Buzzar: what Explore lists by default, set by whoever builds or hosts this copy of Buzzar in config.json's
 * "explore" section:
 *
 *   "explore": {
 *     "includeOwnServer": true,                 // the signed-in user's homeserver directory (default true)
 *     "directoryServers": ["example.org"],      // more room directories everyone gets
 *     "suggestedWorlds": [                      // worlds listed under "Suggested Worlds"
 *       "#some-world:example.org",
 *       { "roomId": "!abc123:example.org", "via": ["example.org"] }
 *     ]
 *   }
 *
 * Users can still add their own servers (saved in their account data) and switch any of these off in Explore.
 */
import configData from "../../../config.json";
import { normalizeServerName } from "./worldDirectory";

/** A suggested world: an alias, or a room ID with the servers to reach it through. */
export interface SuggestedWorldRef {
  /** #alias:server or !roomid. */
  target: string;
  via: string[];
}

export interface ExploreConfig {
  includeOwnServer: boolean;
  directoryServers: string[];
  suggestedWorlds: SuggestedWorldRef[];
}

const ALIAS_REGEX = /^#[^\s:]+:[A-Za-z0-9.\-:[\]]+$/;
const ROOM_ID_REGEX = /^![^\s]+$/;
const MAX_SUGGESTED = 100;

function parseSuggested(entry: unknown): SuggestedWorldRef | undefined {
  if (typeof entry === "string") {
    const value = entry.trim();
    if (ALIAS_REGEX.test(value) || ROOM_ID_REGEX.test(value)) return { target: value, via: [] };
    return undefined;
  }
  if (typeof entry !== "object" || entry === null) return undefined;
  const record = entry as Record<string, unknown>;
  const raw = record.roomId ?? record.room_id ?? record.alias;
  if (typeof raw !== "string") return undefined;
  const target = raw.trim();
  if (!ALIAS_REGEX.test(target) && !ROOM_ID_REGEX.test(target)) return undefined;
  const via: string[] = [];
  if (Array.isArray(record.via)) {
    for (const server of record.via) {
      const name = typeof server === "string" ? normalizeServerName(server) : undefined;
      if (name && !via.includes(name)) via.push(name);
    }
  }
  // A room ID with no via server can only be reached if your homeserver is already in the room; use its own server.
  if (!via.length && target.startsWith("!") && target.includes(":")) via.push(target.slice(target.indexOf(":") + 1));
  return { target, via };
}

/** Reads (untrusted, hand-written) config; anything malformed is skipped. */
export function parseExploreConfig(raw: unknown): ExploreConfig {
  const config: ExploreConfig = { includeOwnServer: true, directoryServers: [], suggestedWorlds: [] };
  if (typeof raw !== "object" || raw === null) return config;
  const record = raw as Record<string, unknown>;
  if (typeof record.includeOwnServer === "boolean") config.includeOwnServer = record.includeOwnServer;
  if (Array.isArray(record.directoryServers)) {
    for (const server of record.directoryServers) {
      const name = typeof server === "string" ? normalizeServerName(server) : undefined;
      if (name && !config.directoryServers.includes(name)) config.directoryServers.push(name);
    }
  }
  if (Array.isArray(record.suggestedWorlds)) {
    for (const entry of record.suggestedWorlds) {
      const ref = parseSuggested(entry);
      if (ref && !config.suggestedWorlds.some((r) => r.target === ref.target)) config.suggestedWorlds.push(ref);
      if (config.suggestedWorlds.length >= MAX_SUGGESTED) break;
    }
  }
  return config;
}

export const exploreConfig = parseExploreConfig((configData as Record<string, unknown>).explore);
