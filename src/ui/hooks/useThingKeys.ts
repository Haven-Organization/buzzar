import { useCallback, useEffect } from "react";
import { useAtom } from "jotai";

import { thingKeysAtom } from "../state/thingKeys";
import { fetchThingKeys, saveThingKeys } from "../utils/thingKeys";
import { getSessionAuth } from "../utils/avatarMatrix";
import { STOCK_THINGS } from "../utils/thingsMatrix";
import { useMatrix } from "./useMatrix";
import { useMainThreadContext } from "./useMainThread";
import { Thread } from "../../engine/module/module.common";
import {
  DEFAULT_THING_KEYS,
  SetThingKeysMessage,
  ThingKeys,
  ThirdRoomMessageType,
} from "../../plugins/thirdroom/thirdroom.common";

const STOCK_IDS = STOCK_THINGS.map((thing) => thing.id);

/**
 * Buzzar: loads your number-key Things when the session starts and keeps the game in step whenever they change.
 * Mounted once, in SessionView.
 */
export function useThingKeysSync() {
  const { session, platform, client } = useMatrix(true);
  const mainThread = useMainThreadContext();
  const [keys, setKeys] = useAtom(thingKeysAtom);

  useEffect(() => {
    let cancelled = false;
    getSessionAuth(platform, client.sessionId)
      .then((auth) => (auth ? fetchThingKeys(auth, session.userId, STOCK_IDS) : undefined))
      .then((loaded) => !cancelled && loaded && setKeys((current) => current ?? loaded))
      .catch((e) => {
        console.warn("Couldn't load your Thing keys; using the defaults.", e);
        if (!cancelled) setKeys((current) => current ?? [...DEFAULT_THING_KEYS]);
      });
    return () => {
      cancelled = true;
    };
  }, [platform, client, session, setKeys]);

  useEffect(() => {
    if (keys)
      mainThread.sendMessage<SetThingKeysMessage>(Thread.Game, { type: ThirdRoomMessageType.SetThingKeys, keys });
  }, [mainThread, keys]);
}

/** Buzzar: changes your number-key Things (straight away in the game, then saved to your account). */
export function useSetThingKeys() {
  const { session, platform, client } = useMatrix(true);
  const [, setKeys] = useAtom(thingKeysAtom);
  return useCallback(
    async (keys: ThingKeys) => {
      setKeys(keys);
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      await saveThingKeys(auth, session.userId, keys);
    },
    [platform, client, session, setKeys]
  );
}
