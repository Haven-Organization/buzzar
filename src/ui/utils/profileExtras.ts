/**
 * Buzzar: extra profile fields shown on name tags (MSC4133 extended profiles).
 * - Pronouns: `m.pronouns` (MSC4247), or its unstable `io.fsky.nyx.pronouns`: [{ language, summary }].
 * - Banner: MSC4427 user banners, an mxc URI (horizontal, ~3:1). Written to the unstable field
 *   `chat.commet.profile_banner`, which other clients already use; the stable `m.banner_url` is read first.
 */
import { MatrixAuth } from "./avatarMatrix";

export const PRONOUNS_KEY = "m.pronouns";
export const PRONOUNS_UNSTABLE_KEY = "io.fsky.nyx.pronouns";
/** MSC4427 unstable banner field (what Buzzar writes). */
export const BANNER_KEY = "chat.commet.profile_banner";
/** MSC4427 stable banner field, read first so Buzzar keeps working once the MSC is accepted. */
export const STABLE_BANNER_KEY = "m.banner_url";

export interface ProfileExtras {
  pronouns?: string;
  bannerUrl?: string;
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
  const asMxc = (v: unknown) => (typeof v === "string" && MXC.test(v) ? v : undefined);
  const bannerUrl = asMxc(profile[STABLE_BANNER_KEY]) ?? asMxc(profile[BANNER_KEY]);
  return {
    ...(pronouns ? { pronouns } : {}),
    ...(bannerUrl ? { bannerUrl } : {}),
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
