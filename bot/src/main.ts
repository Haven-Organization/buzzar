/**
 * Buzzar moderation bot: fills the gaps general Matrix moderation tools (Draupnir, Meowlnir) leave for Buzzar
 * worlds. It uses only the client-server API, so it runs on an ordinary account on any homeserver.
 *
 * Run it next to Draupnir or Meowlnir, which do room bans, redactions and spam checks; this bot only does what they
 * can't. See docs/guides/moderation-bot.md.
 *
 * Usage: npm start [-- --config path/to/config.json]
 */
import { ClientEvent, createClient, RoomMemberEvent, RoomStateEvent, SyncState } from "matrix-js-sdk";
import type { MatrixClient, MatrixEvent, Room, RoomMember } from "matrix-js-sdk";
import type { Logger } from "matrix-js-sdk/lib/logger.js";

import { SERVER_RULE_TYPES, USER_RULE_TYPES, WORLD_MODERATION_EVENT } from "../../src/matrix/policyRules.ts";
import { BanCopier } from "./copyBans.ts";
import { loadConfig, loadSession, saveSession } from "./config.ts";
import type { BotConfig } from "./config.ts";
import { log } from "./util.ts";

/** Buzzar (and Third Room) world rooms carry this state event. */
const WORLD_EVENT = "org.matrix.msc3815.world";
/** How long to wait after a change before checking a world, so a burst of changes is handled once. */
const SETTLE_MS = 2000;
/** Every world is checked again this often, in case an event was missed. */
const RECHECK_MS = 10 * 60 * 1000;

/** The js-sdk's own logging, trimmed to warnings and errors. */
const quietLogger: Logger = {
  trace() {},
  debug() {},
  info() {},
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
  getChild: () => quietLogger,
};

// Parts of the js-sdk log through its own global loggers rather than the client's, at debug level; keep the console
// to warnings and errors (the bot's own lines go straight to stdout).
console.log = console.info = console.debug = console.trace = () => {};

async function connect(config: BotConfig): Promise<MatrixClient> {
  if (config.accessToken) {
    const client = createClient({
      baseUrl: config.homeserverUrl,
      accessToken: config.accessToken,
      logger: quietLogger,
    });
    const { user_id: userId, device_id: deviceId } = await client.whoami();
    if (userId !== config.userId) throw new Error(`The access token is for ${userId}, not ${config.userId}.`);
    return createClient({
      baseUrl: config.homeserverUrl,
      accessToken: config.accessToken,
      userId,
      deviceId: deviceId ?? undefined,
      logger: quietLogger,
    });
  }
  const saved = loadSession(config);
  if (saved) {
    return createClient({
      baseUrl: saved.homeserverUrl,
      accessToken: saved.accessToken,
      userId: saved.userId,
      deviceId: saved.deviceId,
      logger: quietLogger,
    });
  }
  log(`Logging in as ${config.userId}`);
  const login = createClient({ baseUrl: config.homeserverUrl, logger: quietLogger });
  const response = await login.loginRequest({
    type: "m.login.password",
    identifier: { type: "m.id.user", user: config.userId },
    password: config.password!,
    initial_device_display_name: "Buzzar moderation bot",
  });
  saveSession(config, {
    homeserverUrl: config.homeserverUrl,
    userId: response.user_id,
    deviceId: response.device_id,
    accessToken: response.access_token,
  });
  log(`Logged in; the session is saved in ${config.dataDir} (you can remove the password from the config now).`);
  return createClient({
    baseUrl: config.homeserverUrl,
    accessToken: response.access_token,
    userId: response.user_id,
    deviceId: response.device_id,
    logger: quietLogger,
  });
}

function isWorld(room: Room): boolean {
  const state = room.currentState;
  return !!state.getStateEvents(WORLD_EVENT, "") || !!state.getStateEvents(WORLD_MODERATION_EVENT, "");
}

async function main() {
  const configArg = process.argv.indexOf("--config");
  const config = loadConfig(configArg > 0 ? process.argv[configArg + 1] : "config.json");
  const client = await connect(config);
  const me = client.getUserId()!;
  const copier = new BanCopier(client);

  // Worlds the config limits the bot to, as room IDs.
  let allowed: Set<string> | undefined;
  if (config.rooms.length > 0) {
    allowed = new Set();
    for (const room of config.rooms) {
      allowed.add(room.startsWith("#") ? (await client.getRoomIdForAlias(room)).room_id : room);
    }
  }

  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Set<string>();
  const again = new Set<string>();

  const check = async (roomId: string) => {
    if (running.has(roomId)) {
      again.add(roomId);
      return;
    }
    const room = client.getRoom(roomId);
    if (!room || room.getMyMembership() !== "join" || !isWorld(room)) return;
    if (allowed && !allowed.has(roomId)) return;
    running.add(roomId);
    try {
      await copier.update(room);
    } catch (error) {
      log(`${roomId}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running.delete(roomId);
      if (again.delete(roomId)) schedule(roomId);
    }
  };
  const schedule = (roomId: string, delay = SETTLE_MS) => {
    clearTimeout(pending.get(roomId));
    pending.set(
      roomId,
      setTimeout(() => {
        pending.delete(roomId);
        void check(roomId);
      }, delay)
    );
  };
  const scheduleAll = () => {
    for (const room of client.getRooms()) if (room.getMyMembership() === "join" && isWorld(room)) schedule(room.roomId);
  };

  // Accept invites from the owners only.
  const acceptInvite = async (room: Room) => {
    const inviter = room.getMember(me)?.events.member?.getSender();
    if (!inviter || !config.owners.includes(inviter)) {
      log(`Ignoring an invite to ${room.roomId} from ${inviter ?? "someone"} (not an owner)`);
      return;
    }
    try {
      log(`Joining ${room.name || room.roomId}, invited by ${inviter}`);
      await client.joinRoom(room.roomId);
    } catch (error) {
      log(`Couldn't join ${room.roomId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  client.on(RoomMemberEvent.Membership, (_event: MatrixEvent, member: RoomMember) => {
    if (member.userId === me) {
      if (member.membership === "invite") {
        const room = client.getRoom(member.roomId);
        if (room) void acceptInvite(room);
      } else if (member.membership === "join") {
        schedule(member.roomId);
      }
      return;
    }
    // Someone arrived in a world: a user ban that matches them may need copying now.
    schedule(member.roomId);
  });

  client.on(RoomStateEvent.Events, (event: MatrixEvent) => {
    const roomId = event.getRoomId();
    if (!roomId) return;
    const type = event.getType();
    if (type === WORLD_MODERATION_EVENT || type === "m.room.power_levels" || type === WORLD_EVENT) {
      schedule(roomId);
    } else if (USER_RULE_TYPES.has(type) || SERVER_RULE_TYPES.has(type)) {
      // A followed list changed: check the worlds that follow it.
      for (const worldId of copier.followers.get(roomId) ?? []) schedule(worldId);
    }
  });
  // A list we just joined has synced: the worlds waiting on it can copy from it now.
  client.on(ClientEvent.Room, () => scheduleAll());

  client.on(ClientEvent.Sync, (state: SyncState, previous: SyncState | null) => {
    if (state === SyncState.Prepared) {
      log(`Running as ${me}. Owners: ${config.owners.join(", ")}`);
      if (allowed) log(`Only working in: ${config.rooms.join(", ")}`);
      for (const room of client.getRooms()) if (room.getMyMembership() === "invite") void acceptInvite(room);
      scheduleAll();
    } else if (state === SyncState.Error && previous !== SyncState.Error) {
      log("Lost the connection to the homeserver; retrying…");
    } else if (state === SyncState.Syncing && previous === SyncState.Error) {
      log("Reconnected.");
      scheduleAll();
    }
  });
  setInterval(scheduleAll, RECHECK_MS);

  await client.startClient({ initialSyncLimit: 1, lazyLoadMembers: false });

  const stop = () => {
    log("Stopping.");
    client.stopClient();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
