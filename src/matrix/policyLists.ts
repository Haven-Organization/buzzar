/**
 * Buzzar: the ban lists a world follows (Matrix policy lists, MSC2313: the format Meowlnir, Draupnir and Mjolnir
 * publish). The world names its lists in a `software.haven.world.moderation` state event; every visitor's client reads
 * them and holds back anyone they ban (createMatrixNetworkInterface.ts): no avatar, voice, movement or Things either
 * way. That works without any bot running, and takes effect as soon as a list changes. A moderation bot or a
 * moderator then follows up in Matrix (room bans, redactions).
 *
 * Lists are read from the synced room when you've joined it, otherwise from the server (rooms whose history is
 * world-readable, as public ban lists are), refreshed every few minutes.
 */
import { ClientEvent, MatrixClient, MatrixEvent, RoomStateEvent } from "matrix-js-sdk";

export const WORLD_MODERATION_EVENT = "software.haven.world.moderation";

/** The world's moderation settings, from its state event (untrusted). */
export interface WorldModeration {
  /** Room IDs or aliases of the policy lists the world follows. */
  policyRooms: string[];
}

export const MAX_POLICY_ROOMS = 20;

export function parseWorldModeration(content: unknown): WorldModeration {
  const raw = (content as { policy_rooms?: unknown } | undefined)?.policy_rooms;
  const policyRooms = Array.isArray(raw)
    ? [
        ...new Set(
          raw.filter((id): id is string => typeof id === "string" && /^[!#][^:\s]+:\S+$/.test(id) && id.length <= 255)
        ),
      ].slice(0, MAX_POLICY_ROOMS)
    : [];
  return { policyRooms };
}

const USER_RULE_TYPES = new Set(["m.policy.rule.user", "m.room.rule.user", "org.matrix.mjolnir.rule.user"]);
const SERVER_RULE_TYPES = new Set(["m.policy.rule.server", "m.room.rule.server", "org.matrix.mjolnir.rule.server"]);
const BAN_RECOMMENDATIONS = new Set(["m.ban", "org.matrix.mjolnir.ban"]);

export interface PolicyRule {
  kind: "user" | "server";
  /** A user ID or server name, possibly with `*` and `?` globs. */
  entity: string;
  reason?: string;
}

/** The ban rules among a policy room's state events. Rules with other recommendations, or removed ones, are skipped. */
export function parsePolicyRules(events: { type: string; content: unknown }[]): PolicyRule[] {
  const rules: PolicyRule[] = [];
  for (const { type, content } of events) {
    const kind = USER_RULE_TYPES.has(type) ? "user" : SERVER_RULE_TYPES.has(type) ? "server" : undefined;
    if (!kind) continue;
    const c = content as { entity?: unknown; recommendation?: unknown; reason?: unknown } | undefined;
    if (typeof c?.entity !== "string" || !c.entity || c.entity.length > 512) continue;
    if (typeof c.recommendation !== "string" || !BAN_RECOMMENDATIONS.has(c.recommendation)) continue;
    rules.push({ kind, entity: c.entity, reason: typeof c.reason === "string" ? c.reason.slice(0, 500) : undefined });
  }
  return rules;
}

const globCache = new Map<string, RegExp>();

/** Matrix policy globs: `*` any run of characters, `?` one character; everything else literal, case-sensitive. */
export function globMatches(glob: string, value: string): boolean {
  if (!glob.includes("*") && !glob.includes("?")) return glob === value;
  let pattern = globCache.get(glob);
  if (!pattern) {
    const source = glob
      .split("")
      .map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[\\^$.|+()[\]{}]/g, "\\$&")))
      .join("");
    pattern = new RegExp(`^${source}$`, "s");
    if (globCache.size > 2000) globCache.clear();
    globCache.set(glob, pattern);
  }
  return pattern.test(value);
}

/** The server name of a user ID (`@name:server` → `server`). */
export function serverOf(userId: string): string {
  return userId.slice(userId.indexOf(":") + 1);
}

/** The first rule that bans this user, if any. */
export function findBan(rules: PolicyRule[], userId: string): PolicyRule | undefined {
  const server = serverOf(userId);
  return rules.find((rule) => globMatches(rule.entity, rule.kind === "user" ? userId : server));
}

/** How one followed list could be read. */
export interface PolicyRoomStatus {
  room: string;
  rules: number;
  error?: string;
}

const REFRESH_MS = 5 * 60 * 1000;

/**
 * Follows one world's ban lists while you're in it: knows who they ban, and says when that changes. The world's
 * moderation event is watched too, so lists added or removed in World Settings apply at once.
 */
export class WorldBanList {
  private rulesByRoom = new Map<string, PolicyRule[]>();
  private statuses: PolicyRoomStatus[] = [];
  private followed: string[] = [];
  private timer?: number;
  private disposed = false;
  private listeners = new Set<() => void>();
  private resolvedIds = new Map<string, string>();

  constructor(private client: MatrixClient, private worldRoomId: string) {
    client.on(RoomStateEvent.Events, this.onState);
    client.on(ClientEvent.Room, this.onRoom);
    this.timer = window.setInterval(() => void this.refresh(), REFRESH_MS);
    void this.refresh();
  }

  /** Called whenever the set of banned users may have changed. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get status(): PolicyRoomStatus[] {
    return this.statuses;
  }

  /** The rule banning this user in this world, if any. */
  banOf(userId: string): PolicyRule | undefined {
    for (const rules of this.rulesByRoom.values()) {
      const rule = findBan(rules, userId);
      if (rule) return rule;
    }
    return undefined;
  }

  dispose() {
    this.disposed = true;
    this.client.off(RoomStateEvent.Events, this.onState);
    this.client.off(ClientEvent.Room, this.onRoom);
    window.clearInterval(this.timer);
    this.listeners.clear();
  }

  private onState = (event: MatrixEvent) => {
    const roomId = event.getRoomId();
    if (!roomId) return;
    if (roomId === this.worldRoomId && event.getType() === WORLD_MODERATION_EVENT) {
      void this.refresh();
      return;
    }
    // A followed list we've joined changed: read it again from the synced room.
    if ([...this.resolvedIds.values()].includes(roomId) && event.isState()) {
      const type = event.getType();
      if (USER_RULE_TYPES.has(type) || SERVER_RULE_TYPES.has(type)) void this.refresh();
    }
  };

  private onRoom = () => {
    // Joined a followed list: its synced state can replace the server copy.
    if (this.followed.length > 0) void this.refresh();
  };

  private refreshing?: Promise<void>;
  private again = false;

  private refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true;
      return this.refreshing;
    }
    this.refreshing = this.load().finally(() => {
      this.refreshing = undefined;
      if (this.again && !this.disposed) {
        this.again = false;
        void this.refresh();
      }
    });
    return this.refreshing;
  }

  private async load() {
    const world = this.client.getRoom(this.worldRoomId);
    const content = world?.currentState.getStateEvents(WORLD_MODERATION_EVENT, "")?.getContent();
    const { policyRooms } = parseWorldModeration(content);
    this.followed = policyRooms;

    const rulesByRoom = new Map<string, PolicyRule[]>();
    const statuses: PolicyRoomStatus[] = [];
    await Promise.all(
      policyRooms.map(async (room) => {
        try {
          const roomId = await this.resolve(room);
          const events = await this.stateOf(roomId);
          const rules = parsePolicyRules(events);
          rulesByRoom.set(room, rules);
          statuses.push({ room, rules: rules.length });
        } catch (error) {
          // Keep what we had for a list that can't be read right now (a network blip shouldn't unban anyone).
          const previous = this.rulesByRoom.get(room);
          if (previous) rulesByRoom.set(room, previous);
          statuses.push({ room, rules: previous?.length ?? 0, error: describe(error) });
        }
      })
    );
    if (this.disposed) return;
    this.rulesByRoom = rulesByRoom;
    this.statuses = policyRooms.map((room) => statuses.find((s) => s.room === room)!);
    for (const listener of this.listeners) listener();
  }

  private async resolve(room: string): Promise<string> {
    if (room.startsWith("!")) {
      this.resolvedIds.set(room, room);
      return room;
    }
    const known = this.resolvedIds.get(room);
    if (known) return known;
    const roomId = (await this.client.getRoomIdForAlias(room)).room_id;
    this.resolvedIds.set(room, roomId);
    return roomId;
  }

  private async stateOf(roomId: string): Promise<{ type: string; content: unknown }[]> {
    const joined = this.client.getRoom(roomId);
    if (joined?.getMyMembership() === "join") {
      const events: { type: string; content: unknown }[] = [];
      for (const type of [...USER_RULE_TYPES, ...SERVER_RULE_TYPES]) {
        for (const event of joined.currentState.getStateEvents(type)) {
          events.push({ type, content: event.getContent() });
        }
      }
      return events;
    }
    const state = await this.client.roomState(roomId);
    return state.map((event) => ({ type: event.type, content: event.content }));
  }
}

function describe(error: unknown): string {
  const code = (error as { errcode?: string })?.errcode;
  if (code === "M_FORBIDDEN") return "This list isn't public, and you haven't joined it.";
  if (code === "M_NOT_FOUND") return "No such room.";
  return error instanceof Error ? error.message : String(error);
}
