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
  SetThingClonesMessage,
  ThingClone,
  ThirdRoomMessageType,
} from "../../plugins/thirdroom/thirdroom.common";
import { ThirdroomModule } from "../../plugins/thirdroom/thirdroom.main";

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
