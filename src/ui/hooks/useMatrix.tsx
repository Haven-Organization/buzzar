import { createContext, useContext } from "react";

import { Platform, Client, Session, ILogger, Room, ILoginMethod } from "../../matrix";

/** The app's Matrix context: the client, the signed-in session and the browser services they share. */
export interface MatrixContext {
  client: Client;
  platform: Platform;
  session?: Session;
  profileRoom?: Room;
  logger: ILogger;
  /** Unused; kept so callers that pass it along still compile. */
  urlRouter: undefined;
  login: (loginMethod: ILoginMethod) => Promise<void>;
  logout: () => Promise<void>;
}

export interface AuthenticatedMatrixContext extends MatrixContext {
  session: Session;
  profileRoom: Room;
}

export const MatrixContext = createContext<MatrixContext | undefined>(undefined);

export const MatrixContextProvider = MatrixContext.Provider;

export function useMatrix(ensureAuth: true): AuthenticatedMatrixContext;
export function useMatrix(ensureAuth: false): MatrixContext;
export function useMatrix(ensureAuth?: boolean): MatrixContext;
export function useMatrix(ensureAuth = false): MatrixContext | AuthenticatedMatrixContext {
  const context = useContext(MatrixContext);

  if (!context) {
    throw new Error("MatrixContext not initialized");
  }

  if (ensureAuth && !context.session) {
    throw new Error("Must be authenticated to access authenticated Matrix context");
  }

  return context;
}
