import { createContext, useContext } from "react";

import { Platform, Client, Session, ILogger, Room, ILoginMethod } from "../../matrix";

/** The app's Matrix context. (The name is historical: Buzzar ran on the Hydrogen SDK until plan 02.) */
export interface HydrogenContext {
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

export interface AuthenticatedHydrogenContext extends HydrogenContext {
  session: Session;
  profileRoom: Room;
}

export const HydrogenContext = createContext<HydrogenContext | undefined>(undefined);

export const HydrogenContextProvider = HydrogenContext.Provider;

export function useHydrogen(ensureAuth: true): AuthenticatedHydrogenContext;
export function useHydrogen(ensureAuth: false): HydrogenContext;
export function useHydrogen(ensureAuth?: boolean): HydrogenContext;
export function useHydrogen(ensureAuth = false): HydrogenContext | AuthenticatedHydrogenContext {
  const context = useContext(HydrogenContext);

  if (!context) {
    throw new Error("HydrogenContext not initialized");
  }

  if (ensureAuth && !context.session) {
    throw new Error("Must be authenticated to access authenticated hydrogen context");
  }

  return context;
}
