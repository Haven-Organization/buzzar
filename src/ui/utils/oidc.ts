/**
 * Buzzar: sign-in through the homeserver's OAuth 2.0 / OIDC server, such as Matrix Authentication Service (MAS),
 * which matrix.org and other current homeservers use instead of password login.
 *
 * Hydrogen (the SDK) already does the authorization-code + PKCE flow and token refresh. This adds what it's missing
 * for MAS today:
 * - discovery through `/_matrix/client/v1/auth_metadata` (Matrix 1.15) and its MSC2965 unstable forms; Hydrogen
 *   only knows the 2023 `.well-known` key, which servers no longer publish;
 * - client metadata MAS accepts: Hydrogen registers as "Hydrogen Web" with Element's terms and privacy links, and
 *   MAS rejects links on another host than `client_uri`;
 * - a "native" registration with a loopback redirect when Buzzar runs on localhost (dev server, desktop app),
 *   because MAS only allows https for web clients;
 * - caching the dynamic client registration, and readable errors.
 */
import { OidcApi, Platform, QueryOIDCResult, URLRouter } from "@thirdroom/hydrogen-view-sdk";

/** Public https address used as `client_uri` when Buzzar itself runs on localhost. */
export const DEFAULT_PUBLIC_CLIENT_URI = "https://buzzar.haven.software/";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function isLoopbackOrigin(origin = window.location.origin) {
  const url = new URL(origin);
  return url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname);
}

/** The redirect URI Buzzar registers and sends; Hydrogen's URL router uses the same one. */
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
 * `homeserver` is the client-server API base URL (the `homeserver` of a Hydrogen QueryLoginResult).
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

function registrationCacheKey(issuer: string, redirectUri: string) {
  return `buzzar_oidc_client:${issuer}:${redirectUri}`;
}

/** Hydrogen's OidcApi with Buzzar's client metadata, cached dynamic registration and readable errors. */
export class BuzzarOidcApi extends OidcApi {
  private publicClientUri: string;

  constructor(options: { issuer: string; platform: Platform; urlRouter: URLRouter; clientId?: string }) {
    const { issuer, platform, urlRouter, clientId } = options;
    super({
      issuer,
      clientId,
      staticClients: platform.config.staticOidcClients,
      request: platform.request,
      encoding: platform.encoding,
      crypto: platform.crypto,
      urlRouter,
    });
    this.publicClientUri = platform.config.oidcClientUri ?? DEFAULT_PUBLIC_CLIENT_URI;
  }

  get clientMetadata() {
    const redirectUri = oidcRedirectUri();
    if (isLoopbackOrigin()) {
      // MAS accepts http loopback redirects only for native clients, which still need an https client_uri.
      return {
        client_name: "Buzzar (local)",
        client_uri: this.publicClientUri,
        application_type: "native",
        response_types: ["code"],
        grant_types: ["authorization_code", "refresh_token"],
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
      } as unknown as OidcApi["clientMetadata"];
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
    } as unknown as OidcApi["clientMetadata"];
  }

  registration(): Promise<any> {
    const self = this as unknown as { _registrationPromise?: Promise<any> };
    if (!self._registrationPromise) {
      self._registrationPromise = this.register().catch((error) => {
        self._registrationPromise = undefined;
        throw error;
      });
    }
    return self._registrationPromise;
  }

  private async register(): Promise<{ client_id: string }> {
    const staticClients = (this as unknown as { _staticClients: Record<string, { client_id: string }> })._staticClients;
    const authority = this.issuer.endsWith("/") ? this.issuer : `${this.issuer}/`;
    if (staticClients?.[authority]) return staticClients[authority];

    const cacheKey = registrationCacheKey(this.issuer, oidcRedirectUri());
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return { client_id: cached };
    } catch {
      // storage unavailable: register again
    }

    const endpoint = await this.registrationEndpoint();
    if (!endpoint) throw new OidcRegistrationError("This homeserver's sign-in service doesn't accept new apps.");
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(this.clientMetadata),
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
    return body;
  }

  /** Forgets a cached registration, e.g. after the server says the client is unknown. */
  forgetRegistration() {
    try {
      localStorage.removeItem(registrationCacheKey(this.issuer, oidcRedirectUri()));
    } catch {
      // ignore
    }
    (this as unknown as { _registrationPromise?: Promise<any> })._registrationPromise = undefined;
  }
}

/**
 * Sends the browser to the issuer's sign-in page. `prompt: "create"` opens registration instead (MSC2965/OIDC
 * `prompt=create`, which MAS supports).
 */
export async function startOidcLogin(
  platform: Platform,
  urlRouter: URLRouter,
  homeserver: string,
  oidc: QueryOIDCResult,
  options: { prompt?: "create" } = {}
) {
  const oidcApi = new BuzzarOidcApi({ issuer: oidc.issuer, platform, urlRouter });
  await oidcApi.metadata();
  const { settingsStorage, openUrl } = platform;
  const deviceScope = oidcApi.generateDeviceScope();
  const param = oidcApi.generateParams({
    scope: `openid urn:matrix:org.matrix.msc2967.client:api:* ${deviceScope}`,
    redirectUri: oidcRedirectUri(),
  });
  const clientId = await oidcApi.clientId();
  await Promise.all([
    settingsStorage.setInt(`oidc_${param.state}_started_at`, Date.now()),
    settingsStorage.setString(`oidc_${param.state}_nonce`, param.nonce ?? ""),
    settingsStorage.setString(`oidc_${param.state}_code_verifier`, param.codeVerifier ?? ""),
    settingsStorage.setString(`oidc_${param.state}_redirect_uri`, param.redirectUri),
    settingsStorage.setString(`oidc_${param.state}_homeserver`, homeserver),
    settingsStorage.setString(`oidc_${param.state}_issuer`, oidc.issuer),
    settingsStorage.setString(`oidc_${param.state}_client_id`, clientId),
    settingsStorage.setString(`oidc_${param.state}_account_management_url`, oidc.account ?? ""),
  ]);
  const link = new URL(await oidcApi.authorizationEndpoint(param));
  if (options.prompt) link.searchParams.set("prompt", options.prompt);
  openUrl(link.toString());
}
