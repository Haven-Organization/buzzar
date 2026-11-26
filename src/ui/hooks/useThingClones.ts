import { useCallback, useEffect, useState } from "react";
import { useAtom } from "jotai";

import { thingClonesAtom } from "../state/thingClones";
import { fetchThingClones, saveThingClones } from "../utils/thingClones";
import { getSessionAuth } from "../utils/avatarMatrix";
import { useMatrix } from "./useMatrix";
import { useMainThreadContext } from "./useMainThread";
import { getModule, registerMessageHandler, Thread } from "../../engine/module/module.common";
import {
  SetActionBarItemsMessage,
  SetCustomThingsMessage,
  SetThingClonesMessage,
  ThingClone,
  ThirdRoomMessageType,
} from "../../plugins/thirdroom/thirdroom.common";
import { ThirdroomModule } from "../../plugins/thirdroom/thirdroom.main";
import { fetchThingCollection, ThingCollection } from "../utils/thingsMatrix";
import { MainContext } from "../../engine/MainThread";
import { Session } from "../../matrix/session";

/**
 * Buzzar: loads your cloned Things when the session starts and keeps the game in step whenever they change.
 * Mounted once, in SessionView.
 */
export function useThingClonesSync() {
  const { session, platform, client } = useMatrix(true);
  const mainThread = useMainThreadContext();
  const [clones, setClones] = useAtom(thingClonesAtom);

  useEffect(() => {
    let cancelled = false;
    getSessionAuth(platform, client.sessionId)
      .then((auth) => (auth ? fetchThingClones(auth, session.userId) : undefined))
      .then((loaded) => !cancelled && loaded && setClones((current) => current ?? loaded))
      .catch((e) => {
        console.warn("Couldn't load your cloned Things.", e);
        if (!cancelled) setClones((current) => current ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [platform, client, session, setClones]);

  useEffect(() => {
    if (clones)
      mainThread.sendMessage<SetThingClonesMessage>(Thread.Game, {
        type: ThirdRoomMessageType.SetThingClones,
        clones,
      });
  }, [mainThread, clones]);
}

/** Buzzar: tells the game your own Things' names and pictures (for the action bar). */
export function sendCustomThings(mainThread: MainContext, session: Session, collection: ThingCollection) {
  mainThread.sendMessage<SetCustomThingsMessage>(Thread.Game, {
    type: ThirdRoomMessageType.SetCustomThings,
    things: collection.things.map((thing) => ({
      id: thing.url,
      name: thing.name || "Thing",
      thumbnail: thing.preview_url
        ? session.mediaRepository.mxcUrlThumbnail(thing.preview_url, 96, 96, "crop") ?? undefined
        : undefined,
    })),
  });
}

/**
 * Buzzar: sends your own Things to the game when the session starts, so ones on number keys have their names before
 * the Things screen is opened. Mounted once, in SessionView.
 */
export function useCustomThingsSync() {
  const { session, platform, client } = useMatrix(true);
  const mainThread = useMainThreadContext();
  useEffect(() => {
    let cancelled = false;
    getSessionAuth(platform, client.sessionId)
      .then((auth) => (auth ? fetchThingCollection(auth, session.userId) : undefined))
      .then((collection) => !cancelled && collection && sendCustomThings(mainThread, session, collection))
      .catch((e) => console.warn("Couldn't load your Things.", e));
    return () => {
      cancelled = true;
    };
  }, [platform, client, session, mainThread]);
}

/** Buzzar: changes your cloned Things (straight away in the game, then saved to your account). */
export function useSetThingClones() {
  const { session, platform, client } = useMatrix(true);
  const [, setClones] = useAtom(thingClonesAtom);
  return useCallback(
    async (clones: ThingClone[]) => {
      setClones(clones);
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      await saveThingClones(auth, session.userId, clones);
    },
    [platform, client, session, setClones]
  );
}

/** Buzzar: the stock Things the current world's rules allow (a clone is allowed when its base is). */
export function useAllowedThings(): string[] {
  const mainThread = useMainThreadContext();
  const [allowed, setAllowed] = useState<string[]>(() => getModule(mainThread, ThirdroomModule).allowedThings);
  useEffect(() => {
    setAllowed(getModule(mainThread, ThirdroomModule).allowedThings);
    return registerMessageHandler(
      mainThread,
      ThirdRoomMessageType.SetActionBarItems,
      (_ctx, message: SetActionBarItemsMessage) => message.allowedThings && setAllowed(message.allowedThings)
    );
  }, [mainThread]);
  return allowed;
}
