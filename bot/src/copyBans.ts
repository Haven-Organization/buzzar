/**
 * Copies bans from the lists a world follows into the world room, for lists visitors can't read themselves (most big
 * public lists can only be read by joining them, and visitors don't join them). Every visitor's Buzzar already holds
 * back anyone banned by a rule in the world room, so a copied rule takes effect for everyone at once.
 *
 * Copied are:
 * - every server ban;
 * - a user ban once someone it matches is in the world (joined, invited or knocking), and from then on for as long as
 *   the list keeps it. Big lists hold thousands of user bans, and copying them all would make the world room heavy to
 *   load for every visitor.
 *
 * Never copied: a rule that would hold back the bot or anyone with a raised power level in the world (a list banning
 * a moderator's whole server, say). Copies are marked with `software.haven.copied_from` and use their own state keys,
 * so they never touch bans moderators made by hand; the bot removes a copy when the list lifts the ban or the world
 * stops following the list. A list that can't be read right now keeps its copies (a network blip shouldn't unban
 * anyone).
 */
import { createHash } from "node:crypto";
import type { MatrixClient, Room } from "matrix-js-sdk";

import {
  BOT_STATUS_EVENT,
  copiedFrom,
  COPIED_FROM,
  globMatches,
  parsePolicyRules,
  parseWorldModeration,
  SERVER_RULE_TYPES,
  serverOf,
  USER_RULE_TYPES,
  WORLD_MODERATION_EVENT,
} from "../../src/matrix/policyRules.ts";
import type { BotListStatus, BotStatus, PolicyRule } from "../../src/matrix/policyRules.ts";
import { log, withRetry } from "./util.ts";

const USER_RULE = "m.policy.rule.user";
const SERVER_RULE = "m.policy.rule.server";
/** Upper bound on copied rules per world, to keep the world room light. */
export const MAX_COPIES = 2000;

interface RuleEvent {
  type: string;
  content: Record<string, unknown>;
}

/** The state key a copy of this rule uses: stable, short, and never one a moderator's own ban (`rule:…`) uses. */
function copyKey(list: string, rule: PolicyRule): string {
  const hash = createHash("sha256").update(`${list}\n${rule.kind}\n${rule.entity}`).digest("base64url");
  return `copy:${hash.slice(0, 32)}`;
}

function ruleEvents(room: Room): { type: string; content: unknown }[] {
  const events: { type: string; content: unknown }[] = [];
  for (const type of [...USER_RULE_TYPES, ...SERVER_RULE_TYPES]) {
    for (const event of room.currentState.getStateEvents(type)) events.push({ type, content: event.getContent() });
  }
  return events;
}

/** JSON with object keys sorted, so content compares equal whatever order the server sent its keys in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameContent(a: Record<string, unknown>, b: Record<string, unknown>) {
  return canonical(a) === canonical(b);
}

export class BanCopier {
  /** List room ID → worlds following it, to know which worlds to check when a list changes. */
  readonly followers = new Map<string, Set<string>>();

  private client: MatrixClient;

  constructor(client: MatrixClient) {
    this.client = client;
  }

  private get me() {
    return this.client.getUserId()!;
  }

  /** Joins a followed list if needed. Returns it once its state has synced, or undefined while it's still arriving. */
  private async listRoom(entry: string): Promise<Room | undefined> {
    const roomId = entry.startsWith("!") ? entry : (await this.client.getRoomIdForAlias(entry)).room_id;
    const room = this.client.getRoom(roomId);
    if (room?.getMyMembership() === "join" && room.currentState.getStateEvents("m.room.create", "")) return room;
    if (room?.getMyMembership() !== "join") {
      log(`Joining ban list ${entry}`);
      await withRetry(() => this.client.joinRoom(entry));
    }
    return undefined;
  }

  /** The world's creators and people with a raised power level: never held back by a copied rule. */
  private protectedUsers(world: Room): string[] {
    const users = new Set([this.me]);
    // From room version 12, creators outrank everyone without being listed in the power levels.
    const create = world.currentState.getStateEvents("m.room.create", "");
    const creator = create?.getSender();
    if (creator) users.add(creator);
    const additional = create?.getContent().additional_creators;
    if (Array.isArray(additional)) for (const id of additional) if (typeof id === "string") users.add(id);
    const content = world.currentState.getStateEvents("m.room.power_levels", "")?.getContent() ?? {};
    const usersDefault = typeof content.users_default === "number" ? content.users_default : 0;
    for (const [userId, level] of Object.entries((content.users ?? {}) as Record<string, unknown>)) {
      if (typeof level === "number" && level > usersDefault) users.add(userId);
    }
    return [...users];
  }

  /** Brings one world's copied bans up to date, and reports how that went in the world room. */
  async update(world: Room): Promise<void> {
    const state = world.currentState;
    const { policyRooms } = parseWorldModeration(state.getStateEvents(WORLD_MODERATION_EVENT, "")?.getContent());
    for (const ids of this.followers.values()) ids.delete(world.roomId);

    const people = world
      .getMembers()
      .filter((m) => m.membership === "join" || m.membership === "invite" || m.membership === "knock")
      .map((m) => m.userId);
    const keep = this.protectedUsers(world);
    const holdsBack = (rule: PolicyRule, userId: string) =>
      globMatches(rule.entity, rule.kind === "user" ? userId : serverOf(userId));

    const existing = new Map<string, RuleEvent>();
    for (const type of [USER_RULE, SERVER_RULE]) {
      for (const event of state.getStateEvents(type)) {
        const key = event.getStateKey()!;
        if (key.startsWith("copy:") && copiedFrom(event.getContent())) {
          existing.set(key, { type, content: event.getContent() });
        }
      }
    }

    const wanted = new Map<string, RuleEvent>();
    const lists: BotListStatus[] = [];
    let skippedForSpace = 0;
    for (const entry of policyRooms) {
      const keepOld = () => {
        let kept = 0;
        for (const [key, event] of existing) {
          if (copiedFrom(event.content) !== entry) continue;
          wanted.set(key, event);
          kept++;
        }
        return kept;
      };
      try {
        const room = await this.listRoom(entry);
        if (!room) {
          lists.push({ room: entry, copied: keepOld(), rules: 0, error: "Joining the list…" });
          continue;
        }
        const ids = this.followers.get(room.roomId) ?? new Set<string>();
        ids.add(world.roomId);
        this.followers.set(room.roomId, ids);

        const rules = parsePolicyRules(ruleEvents(room));
        const visibility = room.currentState.getStateEvents("m.room.history_visibility", "")?.getContent();
        if (visibility?.history_visibility === "world_readable") {
          // Visitors read this one themselves.
          lists.push({ room: entry, copied: 0, rules: rules.length, readable: true });
          continue;
        }
        let copied = 0;
        for (const rule of rules) {
          if (keep.some((userId) => holdsBack(rule, userId))) continue;
          const key = copyKey(entry, rule);
          const relevant =
            rule.kind === "server" || existing.has(key) || people.some((userId) => holdsBack(rule, userId));
          if (!relevant) continue;
          if (wanted.size >= MAX_COPIES && !existing.has(key)) {
            skippedForSpace++;
            continue;
          }
          const content: Record<string, unknown> = {
            entity: rule.entity,
            recommendation: "m.ban",
            [COPIED_FROM]: entry,
          };
          if (rule.reason) content.reason = rule.reason;
          wanted.set(key, { type: rule.kind === "user" ? USER_RULE : SERVER_RULE, content });
          copied++;
        }
        lists.push({ room: entry, copied, rules: rules.length });
      } catch (error) {
        const kept = keepOld();
        const code = (error as { errcode?: string })?.errcode;
        const message =
          code === "M_NOT_FOUND"
            ? "There's no room at that address."
            : code === "M_FORBIDDEN"
            ? "The bot can't join this list (it may be invite-only)."
            : error instanceof Error
            ? error.message
            : String(error);
        lists.push({ room: entry, copied: kept, rules: 0, error: message });
        log(`${world.roomId}: can't read ${entry}: ${message}`);
      }
    }

    let worldError: string | undefined;
    const canBan = state.maySendStateEvent(USER_RULE, this.me) && state.maySendStateEvent(SERVER_RULE, this.me);
    const changes: [string, RuleEvent][] = [];
    for (const [key, event] of wanted) {
      const old = existing.get(key);
      if (!old || old.type !== event.type || !sameContent(old.content, event.content)) changes.push([key, event]);
    }
    for (const [key, event] of existing) if (!wanted.has(key)) changes.push([key, { type: event.type, content: {} }]);

    if (!canBan) {
      worldError = "The bot needs permission to change ban rules here (make it a Moderator).";
    } else if (skippedForSpace > 0) {
      worldError = `${skippedForSpace} more bans weren't copied: a world holds at most ${MAX_COPIES} copies.`;
    }
    if (canBan && changes.length > 0) {
      const added = changes.filter(([, e]) => Object.keys(e.content).length > 0).length;
      log(`${world.roomId}: copying ${added} bans, removing ${changes.length - added}`);
      for (const [key, event] of changes) {
        await withRetry(() =>
          this.client.sendStateEvent(world.roomId, event.type as never, event.content as never, key)
        );
      }
    }

    // A world that follows no lists and has no copies hears nothing from the bot.
    const hasReport = !!state.getStateEvents(BOT_STATUS_EVENT, this.me);
    if (policyRooms.length === 0 && existing.size === 0 && !hasReport) return;
    await this.report(world, { lists, error: worldError, checkedTs: Date.now() });
  }

  /** Writes the bot's status to the world room when it changed (World Settings shows it). */
  private async report(world: Room, status: BotStatus) {
    const state = world.currentState;
    if (!state.maySendStateEvent(BOT_STATUS_EVENT, this.me)) {
      if (status.error) log(`${world.roomId}: ${status.error}`);
      return;
    }
    const content: Record<string, unknown> = {
      lists: status.lists.map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined))),
      checked_ts: status.checkedTs,
    };
    if (status.error) content.error = status.error;
    const old = state.getStateEvents(BOT_STATUS_EVENT, this.me)?.getContent() ?? {};
    // Only rewrite unchanged reports now and then, so the world room isn't flooded with state events.
    const stale = typeof old.checked_ts !== "number" || Date.now() - old.checked_ts > 6 * 60 * 60 * 1000;
    if (sameContent({ ...old, checked_ts: 0 }, { ...content, checked_ts: 0 }) && !stale) return;
    await withRetry(() =>
      this.client.sendStateEvent(world.roomId, BOT_STATUS_EVENT as never, content as never, this.me)
    );
  }
}
