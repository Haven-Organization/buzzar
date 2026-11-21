/// <reference lib="ESNext" />
/// <reference lib="WebWorker" />

import {
  MEDIA_AUTH_REQUEST,
  toAuthenticatedMediaUrl,
  versionsSupportAuthenticatedMedia,
} from "./src/ui/utils/mediaAuthUrl";

export declare const self: ServiceWorkerGlobalScope;

const CACHE_VERSION = 1;
const MXC_DOWNLOAD_CACHE = `mxc_download_v${CACHE_VERSION}`;
const MXC_DOWNLOAD_REGEX = /^\S+\/_matrix\/media\/r0\/download\/\S+$/;
const MXC_THUMBNAIL_REGEX = /^\S+\/_matrix\/media\/r0\/thumbnail\/\S+$/;

// --- Authenticated media (Buzzar) ---------------------------------------------------------------
// Buzzar's MediaRepository builds legacy /_matrix/media/r0/{download,thumbnail} URLs. Media uploaded after the 2024
// media freeze is only served from /_matrix/client/v1/media/* with an Authorization header, so we
// rewrite those requests here. The page hands us the access token on request
// (see src/ui/utils/mediaAuth.ts); it is only ever attached to requests for that session's own
// homeserver origin. Cache entries stay keyed by the legacy (token-free) URL.

const MEDIA_AUTH_TIMEOUT_MS = 3000;
const MEDIA_AUTH_TTL_MS = 60_000;

interface MediaAuth {
  homeserver: string; // origin + optional path prefix, no trailing slash
  accessToken: string;
}

let cachedAuth: { auth: MediaAuth | undefined; fetchedAt: number } | undefined;
const authMediaSupport = new Map<string, Promise<boolean>>();

async function requestAuthFromClient(clientId: string | undefined): Promise<MediaAuth | undefined> {
  // Only window clients answer (src/ui/utils/mediaAuth.ts). Requests from the engine's dedicated
  // workers carry the worker's clientId, so fall back to any same-origin window.
  const candidates: Client[] = [];
  if (clientId) {
    const client = await self.clients.get(clientId);
    if (client && client.type === "window") candidates.push(client);
  }
  for (const client of await self.clients.matchAll({ type: "window" })) {
    if (!candidates.some((c) => c.id === client.id)) candidates.push(client);
  }

  for (const client of candidates) {
    const auth = await new Promise<MediaAuth | undefined>((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(undefined), MEDIA_AUTH_TIMEOUT_MS);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        const data = event.data;
        if (data && typeof data.homeserver === "string" && typeof data.accessToken === "string") {
          resolve({ homeserver: data.homeserver.replace(/\/+$/, ""), accessToken: data.accessToken });
        } else {
          resolve(undefined);
        }
      };
      client.postMessage({ type: MEDIA_AUTH_REQUEST }, [channel.port2]);
    });
    if (auth) return auth;
  }

  return undefined;
}

async function getMediaAuth(clientId: string | undefined, forceRefresh = false): Promise<MediaAuth | undefined> {
  const now = Date.now();
  if (!forceRefresh && cachedAuth && now - cachedAuth.fetchedAt < MEDIA_AUTH_TTL_MS) {
    return cachedAuth.auth;
  }
  const auth = await requestAuthFromClient(clientId);
  cachedAuth = { auth, fetchedAt: now };
  return auth;
}

function supportsAuthenticatedMedia(homeserver: string): Promise<boolean> {
  let support = authMediaSupport.get(homeserver);
  if (!support) {
    support = fetch(`${homeserver}/_matrix/client/versions`)
      .then((res) => (res.ok ? res.json() : { versions: [] }))
      .then((body: { versions?: string[] }) => versionsSupportAuthenticatedMedia(body.versions))
      .catch(() => false);
    authMediaSupport.set(homeserver, support);
  }
  return support;
}

async function fetchMedia(request: Request, clientId: string | undefined): Promise<Response> {
  let auth = await getMediaAuth(clientId);
  if (!auth || !(await supportsAuthenticatedMedia(auth.homeserver))) {
    return fetch(request.clone());
  }

  const authUrl = toAuthenticatedMediaUrl(request.url, auth.homeserver);
  if (!authUrl) {
    // Media request for a different homeserver origin: never attach our token.
    return fetch(request.clone());
  }

  const doFetch = (token: string) =>
    fetch(authUrl, { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" });

  let response = await doFetch(auth.accessToken);
  if (response.status === 401) {
    // Token may have been refreshed by the page; ask again once.
    auth = await getMediaAuth(clientId, true);
    if (auth) response = await doFetch(auth.accessToken);
  }
  if (response.status === 404 || response.status === 405 || response.status === 400) {
    // Server claims v1.11 but doesn't serve this media authenticated; try the legacy path.
    const legacy = await fetch(request.clone());
    if (legacy.ok) return legacy;
  }
  return response;
}

// --- Lifecycle ----------------------------------------------------------------------------------

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== MXC_DOWNLOAD_CACHE) {
              return caches.delete(cacheName);
            }
          })
        );
      })
      // Take control of already-open pages (and their workers) so media requests are rewritten
      // without needing a reload.
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event: FetchEvent) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const clientId = event.clientId || event.resultingClientId || undefined;

  if (MXC_THUMBNAIL_REGEX.test(request.url)) {
    event.respondWith(fetchMedia(request, clientId));
    return;
  }

  // Only handle mxc download request.
  if (MXC_DOWNLOAD_REGEX.test(request.url) === false) return;

  event.respondWith(
    caches.open(MXC_DOWNLOAD_CACHE).then((cache) => {
      return cache
        .match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }

          return fetchMedia(request, clientId).then((fetchedResponse) => {
            if (fetchedResponse.ok) {
              event.waitUntil(cache.put(request, fetchedResponse.clone()));
            }

            return fetchedResponse;
          });
        })
        .catch((error) => {
          console.error(`Service Worker Error fetching ${request.url}:`, error);
          throw error;
        });
    })
  );
});
