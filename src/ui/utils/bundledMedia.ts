import { MatrixAuth, uploadMedia } from "./avatarMatrix";
import sharedMedia from "../../../res/sharedMedia.json";

/**
 * Buzzar ships some content with the app (public/worlds/…, the space icon, built-in avatars) instead of pointing at
 * another homeserver's media. Rooms and profiles still need mxc URIs every client can load, so each such file has one
 * shared copy on matrix.org, listed in res/sharedMedia.json, which everyone points at. Nothing is uploaded per user:
 * some homeservers don't let their users upload at all (M_QUOTA_EXCEEDED), and it would put a copy of the
 * same file on every user's server. Only a bundled file missing from the list is still uploaded.
 *
 * When a listed file changes, run scripts/buzzar/sync-shared-media.mjs (sharedMedia.test.ts fails until you do).
 */
const SHARED: Record<string, { mxc: string; sha256: string; size: number }> = sharedMedia;

export function isBundledPath(url: string) {
  return url.startsWith("/");
}

/** The shared copy of a bundled file, if it has one. */
export function sharedMediaFor(path: string) {
  return SHARED[path];
}

/** An mxc URI for a bundled file: its shared copy, or (unlisted files only) an upload to the user's homeserver. */
export async function bundledFileUrl(auth: MatrixAuth, path: string): Promise<{ url: string; size: number }> {
  const shared = SHARED[path];
  if (shared) return { url: shared.mxc, size: shared.size };
  // Revalidate with the server: a cached copy from before an update would upload the old file under the new version.
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Couldn't load bundled file ${path}: ${res.status}`);
  const blob = await res.blob();
  return { url: await uploadMedia(auth, blob, path.split("/").pop()!), size: blob.size };
}
