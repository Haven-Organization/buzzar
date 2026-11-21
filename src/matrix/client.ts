/**
 * Buzzar's Matrix layer (plan 02): signing in and starting a session on matrix-js-sdk: finding what a homeserver
 * offers, password / SSO-token / OIDC logins, saved sessions, sync start-up and sign-out.
 */
import { ClientEvent, createClient, HttpApiEvent, IndexedDBStore, MatrixClient, SyncState } from "matrix-js-sdk";

import { secretStorageCallbacks, waitForKeyBackup } from "./crypto";
import { ObservableValue } from "./observable";
import { discoverOidcIssuer, exchangeOidcCode, QueryOIDCResult, takeOidcLoginState } from "./oidc";
import { ISessionInfo, Platform } from "./platform";
import { Session } from "./session";

export enum LoadStatus {
  NotLoading = "NotLoading",
  Login = "Login",
  LoginFailed = "LoginFailed",
  Loading = "Loading",
  SessionSetup = "SessionSetup",
  FirstSync = "FirstSync",
  Error = "Error",
  Ready = "Ready",
}

export enum LoginFailure {
  Connection = "Connection",
  Credentials = "Credentials",
  Unknown = "Unknown",
}

export enum SyncStatus {
  InitialSync = "InitialSync",
  CatchupSync = "CatchupSync",
  Syncing = "Syncing",
  Stopped = "Stopped",
}

export interface LoginResult {
  homeserver: string;
  accessToken: string;
  userId: string;
  deviceId: string;
  refreshToken?: string;
  oidcIssuer?: string;
  oidcClientId?: string;
  accountManagementUrl?: string;
}

export interface ILoginMethod {
  homeserver: string;
  login(deviceName: string): Promise<LoginResult>;
}

class RequestError extends Error {
  constructor(message: string, readonly status?: number, readonly errcode?: string) {
    super(message);
  }
}

async function postLogin(homeserver: string, body: Record<string, unknown>): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetch(`${homeserver}/_matrix/client/v3/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new RequestError("Connection failed");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new RequestError(json.error ?? `Login failed (${res.status})`, res.status, json.errcode);
  return {
    homeserver,
    accessToken: json.access_token,
    userId: json.user_id,
    deviceId: json.device_id,
    refreshToken: json.refresh_token,
  };
}

export class PasswordLoginMethod implements ILoginMethod {
  constructor(readonly homeserver: string, private username: string, private password: string) {}

  login(deviceName: string) {
    return postLogin(this.homeserver, {
      type: "m.login.password",
      identifier: { type: "m.id.user", user: this.username },
      password: this.password,
      initial_device_display_name: deviceName,
    });
  }
}

/** Finishes an SSO login with the token the homeserver redirected back with. */
export class TokenLoginMethod implements ILoginMethod {
  constructor(readonly homeserver: string, private token: string) {}

  login(deviceName: string) {
    return postLogin(this.homeserver, {
      type: "m.login.token",
      token: this.token,
      initial_device_display_name: deviceName,
    });
  }
}

/** Finishes an OIDC login with the code the sign-in page redirected back with. */
export class OIDCLoginMethod implements ILoginMethod {
  constructor(
    private options: {
      homeserver: string;
      issuer: string;
      clientId: string;
      redirectUri: string;
      codeVerifier: string;
      code: string;
      accountManagementUrl?: string;
    }
  ) {}

  get homeserver() {
    return this.options.homeserver;
  }

  static async fromRedirect(platform: Platform, state: string, code: string) {
    const saved = await takeOidcLoginState(platform, state);
    return saved ? new OIDCLoginMethod({ ...saved, code }) : undefined;
  }

  async login(): Promise<LoginResult> {
    const { homeserver, issuer, clientId, accountManagementUrl } = this.options;
    const tokens = await exchangeOidcCode(this.options, this.options.code);
    const res = await fetch(`${homeserver}/_matrix/client/v3/account/whoami`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const whoami = await res.json().catch(() => ({}));
    if (!res.ok || !whoami.user_id || !whoami.device_id) {
      throw new RequestError(whoami.error ?? "The homeserver didn't accept the sign-in.", res.status, whoami.errcode);
    }
    return {
      homeserver,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      userId: whoami.user_id,
      deviceId: whoami.device_id,
      oidcIssuer: issuer,
      oidcClientId: clientId,
      accountManagementUrl,
    };
  }
}

export interface QueryLoginResult {
  /** The client-server API base URL. */
  homeserver: string;
  password?: (username: string, password: string) => ILoginMethod;
  sso?: { redirectUrl(returnTo: string): string };
  oidc?: QueryOIDCResult;
}

export class AbortableOperation<T> {
  constructor(readonly result: Promise<T>, private controller: AbortController) {}

  abort() {
    this.controller.abort();
  }
}

/** Turns what someone typed ("matrix.org") into the homeserver's client API base URL (.well-known lookup). */
async function resolveHomeserver(input: string, signal: AbortSignal): Promise<string> {
  let base = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) base = `https://${base}`;
  try {
    const res = await fetch(`${base}/.well-known/matrix/client`, { signal });
    if (res.ok) {
      const wellKnown = await res.json();
      const url = wellKnown?.["m.homeserver"]?.base_url;
      if (typeof url === "string" && url) return url.replace(/\/+$/, "");
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    // no .well-known: use the address as typed
  }
  return base;
}

export class Client {
  readonly loadStatus = new ObservableValue<LoadStatus>(LoadStatus.NotLoading);
  readonly sync = { status: new ObservableValue<SyncStatus>(SyncStatus.Stopped) };
  loginFailure: LoginFailure = LoginFailure.Unknown;
  /** Why loading failed, in words. */
  loadError?: Error;
  /** The active session's ID in session storage ("" when signed out). */
  sessionId = "";
  session?: Session;
  /** The matrix-js-sdk client behind the session. */
  matrix?: MatrixClient;

  constructor(private platform: Platform, private options: { deviceName: string } = { deviceName: "Buzzar" }) {}

  /** Finds the homeserver and which sign-in methods it offers. */
  queryLogin(homeserverInput: string): AbortableOperation<QueryLoginResult> {
    const controller = new AbortController();
    const run = async (): Promise<QueryLoginResult> => {
      const homeserver = await resolveHomeserver(homeserverInput, controller.signal);
      const res = await fetch(`${homeserver}/_matrix/client/v3/login`, { signal: controller.signal });
      if (!res.ok) throw new Error(`Not a Matrix homeserver (${res.status})`);
      const flows: { type: string }[] = (await res.json()).flows ?? [];
      const result: QueryLoginResult = { homeserver };
      if (flows.some((flow) => flow.type === "m.login.password")) {
        result.password = (username, password) => new PasswordLoginMethod(homeserver, username, password);
      }
      if (flows.some((flow) => flow.type === "m.login.sso")) {
        result.sso = {
          redirectUrl: (returnTo) =>
            `${homeserver}/_matrix/client/v3/login/sso/redirect?redirectUrl=${encodeURIComponent(returnTo)}`,
        };
      }
      result.oidc = await discoverOidcIssuer(homeserver);
      return result;
    };
    return new AbortableOperation(run(), controller);
  }

  async startWithLogin(loginMethod: ILoginMethod): Promise<void> {
    this.loadStatus.set(LoadStatus.Login);
    let result: LoginResult;
    try {
      result = await loginMethod.login(this.options.deviceName);
    } catch (e) {
      const error = e as RequestError;
      this.loginFailure =
        error.status === undefined
          ? LoginFailure.Connection
          : error.status === 401 || error.status === 403
          ? LoginFailure.Credentials
          : LoginFailure.Unknown;
      this.loadError = error;
      this.loadStatus.set(LoadStatus.LoginFailed);
      return;
    }
    const info: ISessionInfo = {
      id: `${Date.now()}${Math.floor(Math.random() * 1e6)}`,
      deviceId: result.deviceId,
      userId: result.userId,
      homeserver: result.homeserver,
      homeServer: result.homeserver,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      oidcIssuer: result.oidcIssuer,
      oidcClientId: result.oidcClientId,
      accountManagementUrl: result.accountManagementUrl,
      lastUsed: Date.now(),
    };
    await this.platform.sessionInfoStorage.add(info);
    await this.startSession(info);
  }

  async startWithExistingSession(sessionId: string): Promise<void> {
    const info = await this.platform.sessionInfoStorage.get(sessionId);
    if (!info) {
      this.loginFailure = LoginFailure.Credentials;
      this.loadStatus.set(LoadStatus.LoginFailed);
      return;
    }
    await this.startSession(info);
  }

  private async startSession(info: ISessionInfo) {
    this.sessionId = info.id;
    this.loadStatus.set(LoadStatus.Loading);
    const homeserver = (info.homeserver ?? info.homeServer).replace(/\/+$/, "");
    const { sessionInfoStorage } = this.platform;

    const store = new IndexedDBStore({
      indexedDB: window.indexedDB,
      localStorage: window.localStorage,
      dbName: `buzzar-sync-${info.id}`,
    });

    const client = createClient({
      baseUrl: homeserver,
      accessToken: info.accessToken,
      refreshToken: info.refreshToken,
      userId: info.userId,
      deviceId: info.deviceId,
      store,
      timelineSupport: true,
      // World calls: join without a microphone if there is none; signalling goes as plain to-device messages.
      isVoipWithNoMediaAllowed: true,
      useE2eForGroupCall: false,
      cryptoCallbacks: secretStorageCallbacks,
      // OIDC sessions: the SDK refreshes (and on sign-out revokes) tokens itself.
      oauthClientId: info.oidcClientId,
      onTokenRefresh: (tokens) => {
        // Other code (fetch helpers, the service worker) reads the token from storage.
        sessionInfoStorage.update(info.id, {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? info.refreshToken,
        });
      },
    });
    this.matrix = client;
    // (After createClient: the store has to belong to a client before it starts.)
    await store.startup().catch((e) => console.warn("Couldn't open the local sync store", e));

    this.loadStatus.set(LoadStatus.SessionSetup);
    // Developers can skip encryption (localStorage "buzzar.devNoCrypto" = "1"), e.g. to try a build with a token that
    // belongs to another client's device without touching that device's keys.
    let cryptoWanted = true;
    try {
      cryptoWanted = localStorage.getItem("buzzar.devNoCrypto") !== "1";
    } catch {
      // storage unavailable
    }
    if (cryptoWanted) {
      try {
        await client.initRustCrypto({ cryptoDatabasePrefix: `buzzar-crypto-${info.id}` });
      } catch (e) {
        // Sync and unencrypted rooms (worlds) still work; encrypted chats won't.
        console.error("Couldn't start end-to-end encryption", e);
      }
    }

    const session = new Session(client, this.platform, { ...info, homeserver });
    let prepared = false;

    const ready = new Promise<void>((resolve, reject) => {
      const fail = (failure: LoginFailure, error: Error) => {
        if (prepared) return;
        this.loginFailure = failure;
        this.loadError = error;
        this.loadStatus.set(failure === LoginFailure.Credentials ? LoadStatus.LoginFailed : LoadStatus.Error);
        reject(error);
      };
      client.on(HttpApiEvent.SessionLoggedOut, () => {
        if (!prepared) fail(LoginFailure.Credentials, new Error("This session was signed out."));
        else window.dispatchEvent(new CustomEvent("buzzar-session-logged-out"));
      });
      let errors = 0;
      client.on(ClientEvent.Sync, (state: SyncState) => {
        if (state === SyncState.Prepared || state === SyncState.Syncing) {
          this.sync.status.set(SyncStatus.Syncing);
          if (!prepared) {
            prepared = true;
            session.start();
            this.session = session;
            this.loadStatus.set(LoadStatus.Ready);
            resolve();
          }
        } else if (state === SyncState.Catchup) {
          this.sync.status.set(SyncStatus.CatchupSync);
        } else if (state === SyncState.Stopped) {
          this.sync.status.set(SyncStatus.Stopped);
        } else if (state === SyncState.Error && !prepared && ++errors >= 3) {
          fail(LoginFailure.Connection, new Error("Connection timeout. Please try again."));
        }
      });
    });

    this.loadStatus.set(LoadStatus.FirstSync);
    this.sync.status.set(SyncStatus.InitialSync);
    await client.startClient({ lazyLoadMembers: true, initialSyncLimit: 20 });
    await ready.catch(() => undefined);
    if (prepared) {
      sessionInfoStorage.update(info.id, { lastUsed: Date.now() });
      // A device that's already verified may hold the backup key without the backup being on yet (e.g. the key
      // arrived just before the page closed): turn it on and restore older messages' keys.
      waitForKeyBackup(session, 10000).catch(() => undefined);
    }
  }

  /** Signs a session out on the server and forgets it locally. */
  async startLogout(sessionId: string): Promise<void> {
    const info = await this.platform.sessionInfoStorage.get(sessionId);
    const client = this.sessionId === sessionId ? this.matrix : undefined;
    if (client) {
      try {
        await client.logout(true);
      } catch (e) {
        console.warn("Couldn't sign out on the homeserver", e);
        client.stopClient();
      }
      await client.clearStores().catch(() => undefined);
      this.session?.dispose();
      this.session = undefined;
      this.matrix = undefined;
      this.sessionId = "";
    } else if (info) {
      await fetch(`${(info.homeserver ?? info.homeServer).replace(/\/+$/, "")}/_matrix/client/v3/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${info.accessToken}` },
      }).catch(() => undefined);
    }
    await this.platform.sessionInfoStorage.delete(sessionId);
    this.loadStatus.set(LoadStatus.NotLoading);
  }

  dispose() {
    this.matrix?.stopClient();
    this.session?.dispose();
  }
}
