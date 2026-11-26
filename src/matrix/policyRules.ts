/**
 * Buzzar: Matrix ban rules (policy lists, MSC2313) and a world's moderation settings, as plain functions with no
 * imports, shared by the client (policyLists.ts) and the Buzzar moderation bot (bot/), which runs this file directly
 * with Node's type stripping (so: only erasable TypeScript here, no enums or parameter properties).
 */

export const WORLD_MODERATION_EVENT = "software.haven.world.moderation";

/** The world's moderation settings, from its state event (untrusted). */
export interface WorldModeration {
  /** Room IDs or aliases of the policy lists the world follows. */
  policyRooms: string[];
}

export const MAX_POLICY_ROOMS = 20;

/**
 * A room ID or alias: `#alias:server`, `!opaque:server`, or a room version 12 ID (`!` and a hash, no server part).
 */
export function isRoomIdOrAlias(value: string): boolean {
  return value.length <= 255 && (/^#[^:\s]+:\S+$/.test(value) || /^![^\s:]+(:\S+)?$/.test(value));
}

export function parseWorldModeration(content: unknown): WorldModeration {
  const raw = (content as { policy_rooms?: unknown } | undefined)?.policy_rooms;
  const policyRooms = Array.isArray(raw)
    ? [...new Set(raw.filter((id): id is string => typeof id === "string" && isRoomIdOrAlias(id)))].slice(
        0,
        MAX_POLICY_ROOMS
      )
    : [];
  return { policyRooms };
}

export const USER_RULE_TYPES = new Set(["m.policy.rule.user", "m.room.rule.user", "org.matrix.mjolnir.rule.user"]);
export const SERVER_RULE_TYPES = new Set([
  "m.policy.rule.server",
  "m.room.rule.server",
  "org.matrix.mjolnir.rule.server",
]);
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

/**
 * Marks a ban rule the moderation bot copied into a world room from a followed list (the value is that list, as the
 * world names it in `policy_rooms`). The bot removes its copy when the list drops the rule or the world stops
 * following the list.
 */
export const COPIED_FROM = "software.haven.copied_from";

/** Where a copied rule came from, if the bot copied it. */
export function copiedFrom(content: unknown): string | undefined {
  const value = (content as Record<string, unknown> | undefined)?.[COPIED_FROM];
  return typeof value === "string" ? value : undefined;
}

/** The moderation bot's report in a world room (state key: the bot's user ID), shown in World Settings. */
export const BOT_STATUS_EVENT = "software.haven.world.moderation_bot";

export interface BotListStatus {
  /** The followed list, as the world names it. */
  room: string;
  /** Ban rules copied from it into the world room. */
  copied: number;
  /** Rules on the list in all (user and server bans). */
  rules: number;
  /** Visitors can read this list themselves, so nothing needs copying. */
  readable?: boolean;
  error?: string;
}

export interface BotStatus {
  lists: BotListStatus[];
  /** Something stops the bot working in this world (for example, missing permission). */
  error?: string;
  /** When the bot last checked (ms since epoch). */
  checkedTs: number;
}

export function parseBotStatus(content: unknown): BotStatus | undefined {
  const c = content as { lists?: unknown; error?: unknown; checked_ts?: unknown } | undefined;
  if (!c || !Array.isArray(c.lists) || typeof c.checked_ts !== "number") return undefined;
  const lists: BotListStatus[] = [];
  for (const raw of c.lists.slice(0, MAX_POLICY_ROOMS)) {
    const l = raw as Record<string, unknown>;
    if (typeof l?.room !== "string") continue;
    lists.push({
      room: l.room,
      copied: typeof l.copied === "number" ? l.copied : 0,
      rules: typeof l.rules === "number" ? l.rules : 0,
      readable: l.readable === true || undefined,
      error: typeof l.error === "string" ? l.error.slice(0, 300) : undefined,
    });
  }
  return {
    lists,
    error: typeof c.error === "string" ? c.error.slice(0, 300) : undefined,
    checkedTs: c.checked_ts,
  };
}
