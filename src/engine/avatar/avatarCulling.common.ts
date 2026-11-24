/**
 * Buzzar: avatar culling, like VRChat's (Settings → Graphics → Avatar Culling). Only the avatars near you are loaded
 * and drawn: everyone else is shown as the avatar placeholder with their name, until they come close (a big
 * performance win in busy worlds).
 *
 * - Hide Beyond: avatars further than this many metres are hidden.
 * - Show Nearest: at most this many avatars are shown, the nearest ones.
 * - Always Show Friend Avatars: people you have direct messages with are never hidden.
 * - Allow override with "Show Avatar": people you chose to always see (the member list's "Show Avatar") are never
 *   hidden.
 *
 * Each setting can be on or off; culling is off by default. Hidden avatars that weren't loaded yet aren't
 * downloaded at all; ones already loaded are kept (so they reappear at once) but not drawn.
 */

export interface AvatarCullingSettings {
  hideBeyond: { on: boolean; meters: number };
  showNearest: { on: boolean; count: number };
  alwaysShowFriends: boolean;
  allowOverride: boolean;
}

export const AVATAR_CULLING_KEY = "buzzar.avatarCulling";
/** User IDs whose avatar is always shown ("Show Avatar"), kept in this browser. */
export const ALWAYS_SHOW_AVATARS_KEY = "buzzar.alwaysShowAvatars";

export const DEFAULT_AVATAR_CULLING: AvatarCullingSettings = {
  hideBeyond: { on: false, meters: 25 },
  showNearest: { on: false, count: 15 },
  alwaysShowFriends: true,
  allowOverride: true,
};

export const HIDE_BEYOND_RANGE: [number, number] = [5, 200];
export const SHOW_NEAREST_RANGE: [number, number] = [1, 80];
/** Someone shown stays shown until this much further than the limit, so walking along it doesn't flicker. */
export const HIDE_BEYOND_MARGIN = 2;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, [min, max]: [number, number]) => Math.min(max, Math.max(min, value));

export function parseAvatarCulling(value: unknown): AvatarCullingSettings {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const beyond = (v.hideBeyond ?? {}) as Record<string, unknown>;
  const nearest = (v.showNearest ?? {}) as Record<string, unknown>;
  const d = DEFAULT_AVATAR_CULLING;
  return {
    hideBeyond: {
      on: beyond.on === true,
      meters: finite(beyond.meters) ? Math.round(clamp(beyond.meters, HIDE_BEYOND_RANGE)) : d.hideBeyond.meters,
    },
    showNearest: {
      on: nearest.on === true,
      count: finite(nearest.count) ? Math.round(clamp(nearest.count, SHOW_NEAREST_RANGE)) : d.showNearest.count,
    },
    alwaysShowFriends: v.alwaysShowFriends !== false,
    allowOverride: v.allowOverride !== false,
  };
}

export function parseUserIdList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.startsWith("@")) : [];
}

export interface CullCandidate {
  peerId: string;
  distance: number;
}

/**
 * Which players' avatars to hide. `wasCulled`: who was hidden last time (for the margin), `exempt`: never hidden
 * (friends, "Show Avatar").
 */
export function decideCulled(
  candidates: CullCandidate[],
  settings: AvatarCullingSettings,
  exempt: Set<string>,
  wasCulled: Set<string>
): Set<string> {
  const culled = new Set<string>();
  if (!settings.hideBeyond.on && !settings.showNearest.on) return culled;
  const counted = candidates.filter((c) => !exempt.has(c.peerId)).sort((a, b) => a.distance - b.distance);
  counted.forEach((candidate, rank) => {
    const limit = settings.hideBeyond.meters + (wasCulled.has(candidate.peerId) ? 0 : HIDE_BEYOND_MARGIN);
    const tooFar = settings.hideBeyond.on && candidate.distance > limit;
    const notNearest = settings.showNearest.on && rank >= settings.showNearest.count;
    if (tooFar || notNearest) culled.add(candidate.peerId);
  });
  return culled;
}

export const AvatarCullingMessage = "avatar-culling";

/** Main → game: the settings, and whose avatars are never hidden (friends, "Show Avatar"). */
export interface AvatarCullingMessageType {
  type: typeof AvatarCullingMessage;
  settings: AvatarCullingSettings;
  alwaysShow: string[];
}
