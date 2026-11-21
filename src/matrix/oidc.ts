/**
 * Buzzar: sign-in through the homeserver's OAuth 2.0 / OIDC server, such as Matrix Authentication Service (MAS),
 * which matrix.org and other current homeservers use instead of password login.
 *
 * - Discovery through `/_matrix/client/v1/auth_metadata` (Matrix 1.15) and its MSC2965 unstable forms.
 * - Dynamic client registration with metadata MAS accepts (links on the `client_uri`'s host only), cached.
 * - A "native" registration with a loopback redirect when Buzzar runs on localhost (dev server, desktop app),
 *   because MAS only allows https for web clients.
 * - Authorization code flow with PKCE, and refreshing access tokens.
 */
import type { Platform } from "./platform";

/** Public https address used as `client_uri` when Buzzar itself runs on localhost. */
export const DEFAULT_PUBLIC_CLIENT_URI = "https://buzzar.haven.software/";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export interface QueryOIDCResult {
  issuer: string;
  /** The account management page, or "". */
  account: string;
}

export function isLoopbackOrigin(origin = window.location.origin) {
  const url = new URL(origin);
  return url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname);
}

/** The redirect URI Buzzar registers and sends. */
export function oidcRedirectUri(origin = window.location.origin) {
  return `${origin}/`;
}

async function getJson(url: string): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * Finds the homeserver's OAuth/OIDC issuer (e.g. MAS), or undefined when it only offers the legacy login API.
 * `homeserver` is the client-server API base URL.
 */
export async function discoverOidcIssuer(homeserver: string): Promise<QueryOIDCResult | undefined> {
  const base = homeserver.replace(/\/+$/, "");
  for (const path of [
    "/_matrix/client/v1/auth_metadata",
    "/_matrix/client/unstable/org.matrix.msc2965/auth_metadata",
  ]) {
    const metadata = await getJson(base + path);
    if (metadata && typeof metadata.issuer === "string" && typeof metadata.authorization_endpoint === "string") {
      const account = typeof metadata.account_management_uri === "string" ? metadata.account_management_uri : "";
      rememberMetadata(metadata.issuer, metadata);
      return { issuer: metadata.issuer, account };
    }
  }
  // MSC2965's first version: only the issuer, with metadata at the issuer's well-known address.
  const legacy = await getJson(`${base}/_matrix/client/unstable/org.matrix.msc2965/auth_issuer`);
  if (legacy && typeof legacy.issuer === "string") {
    return { issuer: legacy.issuer, account: "" };
  }
  return undefined;
}

export class OidcRegistrationError extends Error {}

interface IssuerMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
}

const metadataCache = new Map<string, IssuerMetadata>();

function metadataKey(issuer: string) {
  return `buzzar_oidc_metadata:${issuer}`;
}

function rememberMetadata(issuer: string, metadata: Record<string, unknown>) {
  if (typeof metadata.authorization_endpoint !== "string" || typeof metadata.token_endpoint !== "string") return;
  const kept: IssuerMetadata = {
    authorization_endpoint: metadata.authorization_endpoint,
    token_endpoint: metadata.token_endpoint,
    registration_endpoint:
      typeof metadata.registration_endpoint === "string" ? metadata.registration_endpoint : undefined,
    revocation_endpoint: typeof metadata.revocation_endpoint === "string" ? metadata.revocation_endpoint : undefined,
  };
  metadataCache.set(issuer, kept);
  try {
    // Kept across the sign-in redirect and restarts, so refreshing a token doesn't need discovery again.
    localStorage.setItem(metadataKey(issuer), JSON.stringify(kept));
  } catch {
    // not cached; fine
  }
}

/** The issuer's endpoints (from discovery, the cache, or its `.well-known/openid-configuration`). */
export async function issuerMetadata(issuer: string): Promise<IssuerMetadata> {
  const cached = metadataCache.get(issuer);
  if (cached) return cached;
  const authority = issuer.endsWith("/") ? issuer : `${issuer}/`;
  const fetched = await getJson(`${authority}.well-known/openid-configuration`);
  if (fetched) rememberMetadata(issuer, fetched);
  if (!metadataCache.has(issuer)) {
    try {
      const stored = JSON.parse(localStorage.getItem(metadataKey(issuer)) ?? "null");
      if (stored?.token_endpoint) metadataCache.set(issuer, stored);
    } catch {
      // ignore
    }
  }
  const metadata = metadataCache.get(issuer);
  if (!metadata) throw new Error("Couldn't reach the homeserver's sign-in service.");
  return metadata;
}

function registrationCacheKey(issuer: string, redirectUri: string) {
  return `buzzar_oidc_client:${issuer}:${redirectUri}`;
}

export function oidcClientMetadata(publicClientUri = DEFAULT_PUBLIC_CLIENT_URI) {
  const redirectUri = oidcRedirectUri();
  if (isLoopbackOrigin()) {
    // MAS accepts http loopback redirects only for native clients, which still need an https client_uri.
    return {
      client_name: "Buzzar (local)",
      client_uri: publicClientUri,
      application_type: "native",
      response_types: ["code"],
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    };
  }
  const origin = window.location.origin;
  // Links have to be on the client_uri's host, so no third-party terms or privacy pages.
  return {
    client_name: "Buzzar",
    client_uri: `${origin}/`,
    logo_uri: `${origin}/icon-512.png`,
    application_type: "web",
    response_types: ["code"],
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: [redirectUri],
    post_logout_redirect_uris: [redirectUri],
    id_token_signed_response_alg: "RS256",
    token_endpoint_auth_method: "none",
  };
}

/** Buzzar's client ID at an issuer: a configured static one, the cached registration, or a new registration. */
export async function oidcClientId(platform: Platform, issuer: string): Promise<string> {
  const authority = issuer.endsWith("/") ? issuer : `${issuer}/`;
  const staticClient = platform.config.staticOidcClients?.[authority];
  if (staticClient) return staticClient.client_id;

  const cacheKey = registrationCacheKey(issuer, oidcRedirectUri());
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;
  } catch {
    // storage unavailable: register again
  }
  const { registration_endpoint: endpoint } = await issuerMetadata(issuer);
  if (!endpoint) throw new OidcRegistrationError("This homeserver's sign-in service doesn't accept new apps.");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(oidcClientMetadata(platform.config.oidcClientUri)),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.client_id !== "string") {
    throw new OidcRegistrationError(
      `The homeserver's sign-in service didn't accept Buzzar: ${body.error_description ?? body.error ?? res.status}`
    );
  }
  try {
    localStorage.setItem(cacheKey, body.client_id);
  } catch {
    // not cached; fine
  }
  return body.client_id;
}

/** Forgets a cached registration, e.g. after the server says the client is unknown. */
export function forgetOidcRegistration(issuer: string) {
  try {
    localStorage.removeItem(registrationCacheKey(issuer, oidcRedirectUri()));
  } catch {
    // ignore
  }
}

function randomString(length: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function base64Url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Sends the browser to the issuer's sign-in page. `prompt: "create"` opens registration instead (MSC2965/OIDC
 * `prompt=create`, which MAS supports).
 */
export async function startOidcLogin(
  platform: Platform,
  _urlRouter: unknown,
  homeserver: string,
  oidc: QueryOIDCResult,
  options: { prompt?: "create" } = {}
) {
  const metadata = await issuerMetadata(oidc.issuer);
  const clientId = await oidcClientId(platform, oidc.issuer);
  const state = randomString(16);
  const nonce = randomString(16);
  const codeVerifier = randomString(64);
  const challenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier)));
  const deviceId = randomString(10);
  const redirectUri = oidcRedirectUri();
  const scope = [
    "openid",
    "urn:matrix:org.matrix.msc2967.client:api:*",
    `urn:matrix:org.matrix.msc2967.client:device:${deviceId}`,
  ].join(" ");

  const { settingsStorage } = platform;
  await Promise.all([
    settingsStorage.setInt(`oidc_${state}_started_at`, Date.now()),
    settingsStorage.setString(`oidc_${state}_nonce`, nonce),
    settingsStorage.setString(`oidc_${state}_code_verifier`, codeVerifier),
    settingsStorage.setString(`oidc_${state}_redirect_uri`, redirectUri),
    settingsStorage.setString(`oidc_${state}_homeserver`, homeserver),
    settingsStorage.setString(`oidc_${state}_issuer`, oidc.issuer),
    settingsStorage.setString(`oidc_${state}_client_id`, clientId),
    settingsStorage.setString(`oidc_${state}_account_management_url`, oidc.account ?? ""),
  ]);

  const link = new URL(metadata.authorization_endpoint);
  link.searchParams.set("response_type", "code");
  link.searchParams.set("response_mode", "fragment");
  link.searchParams.set("client_id", clientId);
  link.searchParams.set("redirect_uri", redirectUri);
  link.searchParams.set("scope", scope);
  link.searchParams.set("state", state);
  link.searchParams.set("nonce", nonce);
  link.searchParams.set("code_challenge_method", "S256");
  link.searchParams.set("code_challenge", challenge);
  if (options.prompt) link.searchParams.set("prompt", options.prompt);
  platform.openUrl(link.toString());
}

export interface OidcTokens {
  accessToken: string;
  refreshToken?: string;
  /** Seconds the access token lasts. */
  expiresIn?: number;
}

async function tokenRequest(issuer: string, params: Record<string, string>): Promise<OidcTokens> {
  const { token_endpoint: endpoint } = await issuerMetadata(issuer);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.access_token !== "string") {
    const error = new Error(
      `The homeserver's sign-in service refused: ${body.error_description ?? body.error ?? res.status}`
    );
    (error as Error & { oidcError?: string }).oidcError = body.error;
    throw error;
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : undefined,
  };
}

/** What `startOidcLogin` saved for a sign-in, read back (and cleared) when the browser returns with a code. */
export async function takeOidcLoginState(platform: Platform, state: string) {
  const { settingsStorage } = platform;
  const keys = ["code_verifier", "redirect_uri", "homeserver", "issuer", "client_id", "account_management_url"];
  const [codeVerifier, redirectUri, homeserver, issuer, clientId, accountManagementUrl] = await Promise.all(
    keys.map((key) => settingsStorage.getString(`oidc_${state}_${key}`))
  );
  for (const key of [...keys, "nonce", "started_at"]) settingsStorage.remove(`oidc_${state}_${key}`);
  // The account management URL is optional (not every OIDC server has one).
  if (!codeVerifier || !redirectUri || !homeserver || !issuer || !clientId) return undefined;
  return {
    codeVerifier,
    redirectUri,
    homeserver,
    issuer,
    clientId,
    accountManagementUrl: accountManagementUrl || undefined,
  };
}

export function exchangeOidcCode(
  login: { issuer: string; clientId: string; redirectUri: string; codeVerifier: string },
  code: string
) {
  return tokenRequest(login.issuer, {
    grant_type: "authorization_code",
    code,
    redirect_uri: login.redirectUri,
    client_id: login.clientId,
    code_verifier: login.codeVerifier,
  });
}

export function refreshOidcToken(issuer: string, clientId: string, refreshToken: string) {
  return tokenRequest(issuer, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
}

/** Tells the issuer a token is no longer needed (sign-out). Best effort. */
export async function revokeOidcToken(issuer: string, clientId: string, token: string) {
  try {
    const { revocation_endpoint: endpoint } = await issuerMetadata(issuer);
    if (!endpoint) return;
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, client_id: clientId }).toString(),
    });
  } catch {
    // signing out locally is what matters
  }
}
