/**
 * Buzzar: instances of a world, like VRChat's. A world's LiveKit call can be split into several separate calls, each
 * its own copy of the world: you see, hear and play with the people in your instance only. Chat stays shared (it's
 * the world's Matrix room).
 *
 * - Each instance is a MatrixRTC slot in the world's room (application "software.haven.world", id = the instance)
 *   and its own LiveKit room. The first is "main", which older Buzzar versions always join.
 * - Anyone can start a new instance any time. Entering without choosing fills up the busiest instance that has room
 *   (the world's "players per instance", World Settings → Calls), and starts a new one when all are full.
 * - Instances can be named when started; otherwise their name is their random number ("#48213"), as in VRChat. The
 *   name is part of the instance ID (`i-48213~Movie%20Night`), so everyone sees it without anything else to store:
 *   ordinary members can only send their call membership, not other room state.
 * - Peer-to-peer (mesh) calls have no instances.
 */

export const MAIN_INSTANCE = "main";
/** Players per instance when the world doesn't say. */
export const DEFAULT_INSTANCE_CAP = 40;
export const MIN_INSTANCE_CAP = 2;
export const MAX_INSTANCE_CAP = 500;

export const MAX_INSTANCE_NAME = 40;
/**
 * Encoded names are kept short: the instance ID goes into a membership's state key with the user and device IDs, and
 * Matrix allows state keys of 255 bytes at most.
 */
const MAX_ENCODED_NAME = 100;
const INSTANCE_ID = /^i-(\d{5})(?:~([A-Za-z0-9%._!*'()~-]{1,100}))?$/;

/** "main", or "i-" and a 5-digit number, then optionally "~" and the URI-encoded name. */
export function isInstanceId(value: unknown): value is string {
  return typeof value === "string" && (value === MAIN_INSTANCE || INSTANCE_ID.test(value));
}

/** A new instance's ID: a random 5-digit number, and its name if given. */
export function newInstanceId(name?: string, random: () => number = Math.random): string {
  const number = String(10000 + Math.floor(random() * 90000));
  const clean = cleanInstanceName(name);
  return clean ? `i-${number}~${encodeURIComponent(clean)}` : `i-${number}`;
}

/**
 * A name as instance IDs keep it: trimmed, single-spaced, at most MAX_INSTANCE_NAME characters (whole characters,
 * never half an emoji) and short enough once encoded.
 */
export function cleanInstanceName(name: string | undefined): string {
  const chars = Array.from((name ?? "").replace(/\s+/g, " ").trim()).slice(0, MAX_INSTANCE_NAME);
  while (chars.length > 0 && encodeURIComponent(chars.join("")).length > MAX_ENCODED_NAME) chars.pop();
  return chars.join("").trim();
}

/** How an instance is shown: "Main", its name, or "#" and its number. */
export function instanceName(id: string): string {
  if (id === MAIN_INSTANCE) return "Main";
  const match = INSTANCE_ID.exec(id);
  if (!match) return id;
  if (match[2]) {
    try {
      const name = cleanInstanceName(decodeURIComponent(match[2]));
      if (name) return name;
    } catch {
      // not valid percent-encoding: fall back to the number
    }
  }
  return `#${match[1]}`;
}

/** The LiveKit room an instance meets in: the world's room ID for "main" (as before instances), else with its ID. */
export function liveKitRoomName(roomId: string, instance: string): string {
  return instance === MAIN_INSTANCE ? roomId : `${roomId}|${instance}`;
}

/** Players per instance, from the world's call event (`instance_cap`, untrusted). */
export function parseInstanceCap(callContent: unknown): number {
  const value = (callContent as { instance_cap?: unknown } | undefined)?.instance_cap;
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(MAX_INSTANCE_CAP, Math.max(MIN_INSTANCE_CAP, value))
    : DEFAULT_INSTANCE_CAP;
}

export interface WorldInstance {
  id: string;
  /** Who's in it (user IDs, one per device). */
  userIds: string[];
  /** When it started (its oldest membership), ms. */
  since: number;
}

/** Instances in display order: main first, then oldest first. */
export function sortInstances(instances: WorldInstance[]): WorldInstance[] {
  return [...instances].sort((a, b) =>
    a.id === MAIN_INSTANCE ? -1 : b.id === MAIN_INSTANCE ? 1 : a.since - b.since || a.id.localeCompare(b.id)
  );
}

/**
 * Which instance to enter. `requested`: an instance ID (a link, or picked in the Instances list), or "new". Without
 * one: the busiest instance with room, main first on a tie; a new instance when every one is full; main when there
 * are none.
 */
export function pickInstance(
  instances: WorldInstance[],
  cap: number,
  requested?: string,
  random?: () => number
): { id: string; isNew: boolean } {
  if (requested === "new") return { id: newInstanceId(undefined, random), isNew: true };
  if (isInstanceId(requested)) {
    return { id: requested, isNew: !instances.some((instance) => instance.id === requested) };
  }
  const open = sortInstances(instances).filter((instance) => instance.userIds.length > 0);
  if (open.length === 0) return { id: MAIN_INSTANCE, isNew: true };
  const withRoom = open.filter((instance) => instance.userIds.length < cap);
  if (withRoom.length === 0) return { id: newInstanceId(undefined, random), isNew: true };
  const busiest = withRoom.reduce((best, instance) =>
    instance.userIds.length > best.userIds.length ? instance : best
  );
  return { id: busiest.id, isNew: false };
}
