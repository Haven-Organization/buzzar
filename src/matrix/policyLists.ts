/**
 * Buzzar: the ban lists a world follows (Matrix policy lists, MSC2313: the format Meowlnir, Draupnir and Mjolnir
 * publish). The world names its lists in a `software.haven.world.moderation` state event; every visitor's client reads
 * them and holds back anyone they ban (createMatrixNetworkInterface.ts): no avatar, voice, movement or Things either
 * way. That works without any bot running, and takes effect as soon as a list changes. A moderation bot or a
 * moderator then follows up in Matrix (room bans, redactions).
 *
 * The world room is a ban list itself: its own `m.policy.rule.*` state events (the spec allows policy rules in any
 * room) always apply. Moderators ban accounts and servers there (World Settings → Moderation & Safety), and a moderation bot
 * copies in rules from lists visitors can't read. Every visitor already has the world room's state, so these apply
 * without joining anything.
 *
 * Other followed lists are read from the synced room when you've joined it, otherwise from the server (only rooms
 * whose history anyone can read; most big public lists aren't), refreshed every few minutes.
 */
import { ClientEvent, MatrixClient, MatrixEvent, Room, RoomStateEvent } from "matrix-js-sdk";

import {
  findBan,
  parsePolicyRules,
  parseWorldModeration,
  PolicyRule,
  SERVER_RULE_TYPES,
  USER_RULE_TYPES,
  WORLD_MODERATION_EVENT,
} from "./policyRules";

export * from "./policyRules";

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
    const own = findBan(this.worldRules, userId);
    if (own) return own;
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
    if (roomId === this.worldRoomId) {
      const type = event.getType();
      if (USER_RULE_TYPES.has(type) || SERVER_RULE_TYPES.has(type)) {
        // The world's own bans: read straight from its state, no round trip.
        this.readWorldRules();
        for (const listener of this.listeners) listener();
      } else if (type === WORLD_MODERATION_EVENT) void this.refresh();
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

  /** The world room's own ban rules. */
  private worldRules: PolicyRule[] = [];

  private readWorldRules() {
    const world = this.client.getRoom(this.worldRoomId);
    this.worldRules = world ? parsePolicyRules(syncedRuleEvents(world)) : [];
  }

  private async load() {
    this.readWorldRules();
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
    if (joined?.getMyMembership() === "join") return syncedRuleEvents(joined);
    const state = await this.client.roomState(roomId);
    return state.map((event) => ({ type: event.type, content: event.content }));
  }
}

/** A synced room's user and server rules, as state events. */
function syncedRuleEvents(room: Room): { type: string; content: unknown }[] {
  const events: { type: string; content: unknown }[] = [];
  for (const type of [...USER_RULE_TYPES, ...SERVER_RULE_TYPES]) {
    for (const event of room.currentState.getStateEvents(type)) events.push({ type, content: event.getContent() });
  }
  return events;
}

function describe(error: unknown): string {
  const code = (error as { errcode?: string })?.errcode;
  if (code === "M_FORBIDDEN") return "This list isn't public, and you haven't joined it.";
  if (code === "M_NOT_FOUND") return "No such room.";
  return error instanceof Error ? error.message : String(error);
}
