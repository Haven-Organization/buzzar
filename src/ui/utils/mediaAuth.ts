import { MEDIA_AUTH_REQUEST } from "./mediaAuthUrl";

export interface MediaAuthInfo {
  homeserver: string;
  accessToken: string;
}

/**
 * Answers the service worker's requests for the current session's homeserver + access token so it can
 * fetch authenticated media (see sw.ts). The token is read fresh on every request so refreshed tokens
 * are picked up. Returns a disposer.
 */
export function installMediaAuthResponder(getAuth: () => Promise<MediaAuthInfo | undefined>): () => void {
  const container = navigator.serviceWorker;
  if (!container) return () => {};

  const onMessage = async (event: MessageEvent) => {
    if (event.data?.type !== MEDIA_AUTH_REQUEST) return;
    const port = event.ports[0];
    if (!port) return;
    try {
      const auth = await getAuth();
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
