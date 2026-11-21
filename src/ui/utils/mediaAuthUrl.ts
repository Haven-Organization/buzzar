/**
 * Shared between the service worker (sw.ts) and the page.
 *
 * Buzzar's MediaRepository builds legacy `/_matrix/media/r0/{download,thumbnail}` URLs. Media uploaded after the 2024
 * media freeze is only served from `/_matrix/client/v1/media/*` (spec v1.11, authenticated media).
 */
export const MEDIA_AUTH_REQUEST = "software.haven.media_auth.request";

/** Returns the authenticated equivalent of a legacy media URL, or undefined if it isn't for `homeserver`. */
export function toAuthenticatedMediaUrl(legacyUrl: string, homeserver: string): string | undefined {
  const base = homeserver.replace(/\/+$/, "");
  const legacyPrefix = `${base}/_matrix/media/r0/`;
  if (!legacyUrl.startsWith(legacyPrefix)) return undefined;
  const rest = legacyUrl.slice(legacyPrefix.length);
  if (!rest.startsWith("download/") && !rest.startsWith("thumbnail/")) return undefined;
  return `${base}/_matrix/client/v1/media/${rest}`;
}

/** Authenticated media landed in spec v1.11. */
export function versionsSupportAuthenticatedMedia(versions: string[] | undefined): boolean {
  return (versions ?? []).some((v) => {
    const match = /^v1\.(\d+)$/.exec(v);
    return match !== null && parseInt(match[1], 10) >= 11;
  });
}
