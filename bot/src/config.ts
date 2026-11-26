/**
 * The bot's settings: config.json (copy config.example.json), with environment variables taking precedence so it can
 * run in a container without a file:
 * BUZZAR_BOT_HOMESERVER, BUZZAR_BOT_USER_ID, BUZZAR_BOT_PASSWORD, BUZZAR_BOT_ACCESS_TOKEN, BUZZAR_BOT_OWNERS
 * (comma-separated), BUZZAR_BOT_ROOMS (comma-separated), BUZZAR_BOT_DATA_DIR.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { isRoomIdOrAlias } from "../../src/matrix/policyRules.ts";

export interface BotConfig {
  homeserverUrl: string;
  userId: string;
  /** Used once to log in; the session is then kept in the data folder. */
  password?: string;
  /** An existing session's access token, instead of a password. */
  accessToken?: string;
  /** Who may invite the bot into rooms. */
  owners: string[];
  /** If set, the only world rooms (IDs or aliases) the bot works in; otherwise every world it's in. */
  rooms: string[];
  /** Where the bot keeps its login session. */
  dataDir: string;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function loadConfig(path: string): BotConfig {
  let file: Record<string, unknown> = {};
  if (existsSync(path)) {
    file = JSON.parse(readFileSync(path, "utf8"));
  } else if (!process.env.BUZZAR_BOT_HOMESERVER) {
    throw new Error(`No ${path}: copy config.example.json to config.json and fill it in.`);
  }
  const env = process.env;
  const owners = env.BUZZAR_BOT_OWNERS
    ? env.BUZZAR_BOT_OWNERS.split(",")
    : Array.isArray(file.owners)
    ? file.owners.filter((o): o is string => typeof o === "string")
    : [];
  const rooms = env.BUZZAR_BOT_ROOMS
    ? env.BUZZAR_BOT_ROOMS.split(",")
    : Array.isArray(file.rooms)
    ? file.rooms.filter((r): r is string => typeof r === "string")
    : [];
  const config: BotConfig = {
    homeserverUrl: (text(env.BUZZAR_BOT_HOMESERVER) ?? text(file.homeserverUrl) ?? "").replace(/\/+$/, ""),
    userId: text(env.BUZZAR_BOT_USER_ID) ?? text(file.userId) ?? "",
    password: text(env.BUZZAR_BOT_PASSWORD) ?? text(file.password),
    accessToken: text(env.BUZZAR_BOT_ACCESS_TOKEN) ?? text(file.accessToken),
    owners: owners.map((o) => o.trim()).filter((o) => /^@[^:]+:.+$/.test(o)),
    rooms: rooms.map((r) => r.trim()).filter(isRoomIdOrAlias),
    dataDir: resolve(text(env.BUZZAR_BOT_DATA_DIR) ?? text(file.dataDir) ?? "data"),
  };
  if (!/^https?:\/\//.test(config.homeserverUrl))
    throw new Error("homeserverUrl must be like https://matrix.example.org");
  if (!/^@[^:]+:.+$/.test(config.userId)) throw new Error("userId must be like @buzzar-bot:example.org");
  if (!config.password && !config.accessToken) throw new Error("Set the bot account's password (or an accessToken).");
  if (config.owners.length === 0) {
    throw new Error("Set owners: the Matrix accounts allowed to invite the bot, like @you:example.org.");
  }
  return config;
}

export interface SavedSession {
  homeserverUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
}

function sessionPath(config: BotConfig) {
  return join(config.dataDir, "session.json");
}

/** The session from a previous password login, if it's for this account and server. */
export function loadSession(config: BotConfig): SavedSession | undefined {
  try {
    const saved = JSON.parse(readFileSync(sessionPath(config), "utf8")) as SavedSession;
    if (saved.userId === config.userId && saved.homeserverUrl === config.homeserverUrl && saved.accessToken) {
      return saved;
    }
  } catch {
    // none yet
  }
  return undefined;
}

export function saveSession(config: BotConfig, session: SavedSession) {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(sessionPath(config), JSON.stringify(session, null, 2), { mode: 0o600 });
}
