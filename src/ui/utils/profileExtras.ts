/**
 * Buzzar: extra profile fields shown on name tags (MSC4133 extended profiles).
 * - Pronouns: `m.pronouns` (MSC4247), or its unstable `io.fsky.nyx.pronouns`: [{ language, summary }].
 * - Banner: `software.haven.banner` (an mxc image). Matrix has no standard banner field yet, so banners set in other
 *   clients are used when there's no Buzzar one (see OTHER_BANNER_KEYS).
 */
import { MatrixAuth } from "./avatarMatrix";

export const PRONOUNS_KEY = "m.pronouns";
export const PRONOUNS_UNSTABLE_KEY = "io.fsky.nyx.pronouns";
export const BANNER_KEY = "software.haven.banner";
/** Banner fields other Matrix clients write, read in this order when there's no Buzzar banner. */
export const OTHER_BANNER_KEYS: { key: string; client: string }[] = [{ key: "chat.commet.profile_banner", client: "Commet" }];

export interface ProfileExtras {
  pronouns?: string;
  bannerUrl?: string;
  /** Set when the banner comes from another client's profile field (its name), not Buzzar's own. */
  bannerFrom?: string;
}

const MXC = /^mxc:\/\/[A-Za-z0-9.\-:[\]]+\/[A-Za-z0-9_-]+$/;

function parsePronouns(value: unknown): string | undefined {
  if (typeof value === "string") return value.slice(0, 40) || undefined;
  if (!Array.isArray(value)) return undefined;
  const first = value.find(
    (p) => p && typeof p === "object" && typeof (p as { summary?: unknown }).summary === "string"
  );
  const summary = (first as { summary?: string } | undefined)?.summary?.trim();
  return summary ? summary.slice(0, 40) : undefined;
}

export function parseProfileExtras(profile: Record<string, unknown> | undefined): ProfileExtras {
  if (!profile) return {};
  const pronouns = parsePronouns(profile[PRONOUNS_KEY]) ?? parsePronouns(profile[PRONOUNS_UNSTABLE_KEY]);
  const asMxc = (v: unknown) => {
    const url = typeof v === "string" ? v : v && typeof v === "object" ? (v as { url?: unknown }).url : undefined;
    return typeof url === "string" && MXC.test(url) ? url : undefined;
  };
  const own = asMxc(profile[BANNER_KEY]);
  const other = own ? undefined : OTHER_BANNER_KEYS.find(({ key }) => asMxc(profile[key]));
  const bannerUrl = own ?? (other ? asMxc(profile[other.key]) : undefined);
  return {
    ...(pronouns ? { pronouns } : {}),
    ...(bannerUrl ? { bannerUrl } : {}),
    ...(other ? { bannerFrom: other.client } : {}),
  };
}

const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: Promise<ProfileExtras> }>();

export function fetchProfileExtras(auth: MatrixAuth, userId: string, force = false): Promise<ProfileExtras> {
  const cached = cache.get(userId);
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = fetch(
    `${auth.homeserver.replace(/\/+$/, "")}/_matrix/client/v3/profile/${encodeURIComponent(userId)}`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } }
  )
    .then((res) => (res.ok ? res.json() : undefined))
    .then((profile) => parseProfileExtras(profile as Record<string, unknown> | undefined))
    .catch(() => ({}));
  cache.set(userId, { at: Date.now(), value });
  return value;
}

/** Sets (or clears, with undefined) one profile field of your own. */
export async function setProfileField(auth: MatrixAuth, userId: string, key: string, value: unknown) {
  const url = `${auth.homeserver.replace(/\/+$/, "")}/_matrix/client/v3/profile/${encodeURIComponent(
    userId
  )}/${encodeURIComponent(key)}`;
  const res =
    value === undefined
      ? await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${auth.accessToken}` } })
      : await fetch(url, {
          method: "PUT",
          headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: value }),
        });
  if (!res.ok && !(res.status === 404 && value === undefined)) {
    throw new Error(`Couldn't update your profile (${key}): ${res.status} ${await res.text()}`);
  }
  cache.delete(userId);
}
