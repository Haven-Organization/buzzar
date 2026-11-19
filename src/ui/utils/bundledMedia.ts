import { MatrixAuth, uploadMedia } from "./avatarMatrix";

/**
 * Buzzar ships some content with the app (public/worlds/…) instead of pointing at another homeserver's media.
 * Rooms still need mxc URIs that every client can load, so bundled files are uploaded to the user's own
 * homeserver when they're first used.
 */
export function isBundledPath(url: string) {
  return url.startsWith("/");
}

export async function uploadBundledFile(auth: MatrixAuth, path: string): Promise<{ url: string; size: number }> {
  // Revalidate with the server: a cached copy from before an update would upload the old file under the new version.
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Couldn't load bundled file ${path}: ${res.status}`);
  const blob = await res.blob();
  return { url: await uploadMedia(auth, blob, path.split("/").pop()!), size: blob.size };
}
