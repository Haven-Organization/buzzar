// @refresh reset
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";

import {
  Platform,
  Client,
  Session,
  LoadStatus,
  LoginFailure,
  OIDCLoginMethod,
  ILoginMethod,
  ISessionInfo,
} from "../../matrix";
import { Text } from "../atoms/text/Text";
import { MatrixContext, MatrixContextProvider } from "../hooks/useMatrix";
import { useAsyncCallback } from "../hooks/useAsyncCallback";
import { useObservableValue } from "../hooks/useObservableValue";
import { LoadingScreen } from "./components/loading-screen/LoadingScreen";
import { Button } from "../atoms/button/Button";
import { useUserProfile } from "../hooks/useUserProfile";
import { registerThirdroomGlobalVar } from "../../engine/utils/registerThirdroomGlobal";
import { CoverScreen } from "./components/cover-screen/CoverScreen";
import configData from "../../../config.json";
import { installMediaAuthResponder } from "../utils/mediaAuth";

interface MatrixInstance {
  client: Client;
  platform: Platform;
}

let matrixInstance: MatrixInstance;

/** Buzzar: the Matrix layer (src/matrix, on matrix-js-sdk), created once. */
function initMatrix() {
  if (matrixInstance) {
    return matrixInstance;
  }

  // Buzzar: no hard-coded OIDC clients. Third Room's Keycloak (id.thirdroom.io) and its guest login are gone.
  const platform = new Platform({ config: { ...configData } });
  const client = new Client(platform, { deviceName: "Buzzar" });

  matrixInstance = { client, platform };

  registerThirdroomGlobalVar("matrix", matrixInstance);

  // Buzzar: let the service worker fetch authenticated media for the active session (see sw.ts).
  installMediaAuthResponder(async () => {
    const sessionId = client.sessionId;
    if (!sessionId) return undefined;
    const info = await platform.sessionInfoStorage.get(sessionId);
    if (!info?.accessToken) return undefined;
    return { homeserver: info.homeserver ?? info.homeServer, accessToken: info.accessToken };
  });

  return matrixInstance;
}

/** What the loading screen says at each step of starting a session. */
const LOADING_MESSAGES: Partial<Record<LoadStatus, string>> = {
  [LoadStatus.Login]: "Signing in…",
  [LoadStatus.Loading]: "Opening your session…",
  [LoadStatus.SessionSetup]: "Setting up encryption…",
  [LoadStatus.FirstSync]: "Syncing your rooms… (the first time can take a minute)",
};

function getSessionInfo(): ISessionInfo | undefined {
  const sessionsJson = localStorage.getItem("buzzar_sessions_v1");
  if (sessionsJson) {
    const sessions = JSON.parse(sessionsJson);
    if (Array.isArray(sessions)) {
      return sessions[0];
    }
  }
  return undefined;
}

function loginFailureToMsg(loginFailure: LoginFailure) {
  if (loginFailure === LoginFailure.Connection) return "Connection timeout. Please try again.";
  if (loginFailure === LoginFailure.Credentials) return "Invalid credentials. Please try again.";
  return "Unknown error. Please try again.";
}

async function loadClient(client: Client, sessionId: string): Promise<Session | undefined> {
  // Buzzar: Third Room cleared all of localStorage (every saved session and setting) whenever a session failed to
  // load, so a connection timeout or a hiccup at startup signed people out. Keep the session on errors and show
  // them (with Refresh); only drop this one session when the homeserver rejected its credentials.
  const loadStatus = client.loadStatus.get();
  if (loadStatus === LoadStatus.Error || loadStatus === LoadStatus.LoginFailed) {
    if (client.loginFailure === LoginFailure.Credentials && sessionId) {
      await client.startLogout(sessionId).catch(() => undefined);
    }
    throw new Error(client.loadError?.message || loginFailureToMsg(client.loginFailure));
  }
  if (client.session) {
    await client.session.callHandler.loadCalls();
    return client.session;
  }
  if (sessionId) await client.startLogout(sessionId);
  return undefined;
}

function useOidcComplete(platform: Platform, login: (loginMethod: ILoginMethod) => Promise<void>) {
  const navigate = useNavigate();
  const started = useRef<string>();
  const completeOidc = async (state: string, code: string) => {
    const loginMethod = await OIDCLoginMethod.fromRedirect(platform, state, code);
    if (!loginMethod) return;
    login(loginMethod);
    navigate("/");
  };
  const location = useLocation();

  if (location.hash !== "") {
    const params = new URLSearchParams(location.hash.slice(1));
    const code = params.get("code");
    const state = params.get("state");
    if (params.get("error")) {
      return params.get("error_description");
    }
    if (code && state && started.current !== state) {
      started.current = state;
      completeOidc(state, code);
    }
  }
  return null;
}
function useSession(client: Client, platform: Platform) {
  const sessionRef = useRef<Session>();
  const session = sessionRef.current ?? undefined;

  const {
    loading: loadingInitialSession,
    error: initialSessionLoadError,
    callback: loadInitialSession,
  } = useAsyncCallback(
    async (sessionInfo: ISessionInfo) => {
      await client.startWithExistingSession(sessionInfo.id);
      sessionRef.current = await loadClient(client, sessionInfo.id);
    },
    [platform, client]
  );

  const {
    loading: loggingIn,
    error: errorLoggingIn,
    callback: login,
  } = useAsyncCallback<(loginMethod: ILoginMethod) => Promise<void>, void>(
    async (loginMethod) => {
      await client.startWithLogin(loginMethod);
      sessionRef.current = await loadClient(client, client.sessionId);
    },
    [client]
  );

  const {
    loading: loggingOut,
    error: errorLoggingOut,
    callback: logout,
  } = useAsyncCallback<() => Promise<void>, void>(async () => {
    if (client && client.session) {
      const availSessions = await platform.sessionInfoStorage.getAll();
      const logoutChain = availSessions.map((session) => client.startLogout(session.id));
      try {
        await Promise.allSettled(logoutChain);
      } catch (err) {
        console.error(err);
      }
      localStorage.clear();

      client.loadStatus.set(LoadStatus.NotLoading);
      sessionRef.current = undefined;
    }
  }, [client, session]);

  const oidcCompleteError = useOidcComplete(platform, login);
  const profileRoom = useUserProfile(client, session);

  const loading = loadingInitialSession || loggingIn || loggingOut || (session && !profileRoom);
  const error = initialSessionLoadError || errorLoggingIn || errorLoggingOut;
  const errorMsg = oidcCompleteError ?? error?.message;

  return {
    session,
    profileRoom,
    loadInitialSession,
    login,
    logout,
    loading,
    errorMsg,
  };
}

export function MatrixRootView() {
  const sessionInfo = getSessionInfo();

  const [{ client, platform }] = useState(initMatrix);
  const loadStatus = useObservableValue(() => client.loadStatus, [client]);

  // Sessions from before plan 02 (another SDK's storage) can't be carried over: end them and say why.
  const [legacyChecked, setLegacyChecked] = useState(() => localStorage.getItem("hydrogen_sessions_v1") === null);
  useEffect(() => {
    if (legacyChecked) return;
    platform.sessionInfoStorage.endLegacySessions().then((hadSessions) => {
      if (hadSessions) {
        sessionStorage.setItem("buzzar_signin_notice", "Buzzar was updated and needs you to sign in again.");
      }
      setLegacyChecked(true);
    });
  }, [legacyChecked, platform]);

  const { session, profileRoom, loadInitialSession, login, logout, loading, errorMsg } = useSession(client, platform);

  useEffect(() => {
    // Signed out elsewhere (or the token was revoked): back to the login page.
    const onLoggedOut = () => {
      logout().finally(() => window.location.assign("/login"));
    };
    window.addEventListener("buzzar-session-logged-out", onLoggedOut);
    return () => window.removeEventListener("buzzar-session-logged-out", onLoggedOut);
  }, [logout]);

  const context = useMemo<MatrixContext>(
    () => ({
      client,
      platform,
      urlRouter: undefined,
      logger: platform.logger,
      session,
      profileRoom,
      login,
      logout,
    }),
    [client, platform, session, profileRoom, login, logout]
  );

  const loginPath = useMatch({ path: "/login" });

  const href = window.location.href;
  const WORLD_PATH_REG = /^\S+(\/world\/(!|#)\S+:\S+)$/;

  if (href.match(WORLD_PATH_REG) && !sessionInfo) {
    localStorage.setItem("on_login_redirect_uri", href);
  }

  if (sessionInfo && !loading && !session) {
    loadInitialSession(sessionInfo);
  }

  if (loading || !legacyChecked) {
    return <LoadingScreen message={LOADING_MESSAGES[loadStatus]} />;
  }

  if (errorMsg) {
    return (
      <CoverScreen className="gap-md">
        <Text variant="b1" weight="semi-bold">
          {errorMsg}
        </Text>
        <Button onClick={() => window.location.reload()}>Refresh</Button>
      </CoverScreen>
    );
  }

  if (!session && !sessionInfo && href.match(WORLD_PATH_REG)) {
    return <Navigate to="/login" replace={true} />;
  }

  // Buzzar: no in-app landing page (it lives at haven.software/buzzar/); signed-out visitors go straight to login.
  if (!loginPath && !session && !sessionInfo) {
    return <Navigate to="/login" replace={true} />;
  }

  const onLoginRedirectPath = localStorage.getItem("on_login_redirect_uri")?.match(WORLD_PATH_REG)?.[1];
  if (sessionInfo && onLoginRedirectPath) {
    localStorage.removeItem("on_login_redirect_uri");
    return <Navigate to={onLoginRedirectPath} />;
  }

  if (loginPath && sessionInfo) {
    return <Navigate to="/" replace={true} />;
  }

  return (
    <MatrixContextProvider value={context}>
      <Outlet />
    </MatrixContextProvider>
  );
}
