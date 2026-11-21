import { MEDIA_AUTH_REQUEST } from "./mediaAuthUrl";

export interface MediaAuthInfo {
  homeserver: string;
  accessToken: string;
}

/**
 * Answers the service worker's requests for the current session's homeserver + access token so it can
 * fetch authenticated media (see sw.ts). The token is read fresh on every request so refreshed tokens
 * are picked up; with `refresh`, the session is asked to refresh an expired token before answering.
 * Returns a disposer.
 */
export function installMediaAuthResponder(
  getAuth: (refresh: boolean) => Promise<MediaAuthInfo | undefined>
): () => void {
  const container = navigator.serviceWorker;
  if (!container) return () => {};

  const onMessage = async (event: MessageEvent) => {
    if (event.data?.type !== MEDIA_AUTH_REQUEST) return;
    const port = event.ports[0];
    if (!port) return;
    try {
      // `refresh`: the service worker's token was rejected (expired), so make sure ours is current first.
      const auth = await getAuth(event.data.refresh === true);
      port.postMessage(auth ? { homeserver: auth.homeserver, accessToken: auth.accessToken } : null);
    } catch (error) {
      console.error("Failed to provide media auth to service worker", error);
      port.postMessage(null);
    }
  };

  container.addEventListener("message", onMessage);
  container.startMessages();

  return () => container.removeEventListener("message", onMessage);
}
