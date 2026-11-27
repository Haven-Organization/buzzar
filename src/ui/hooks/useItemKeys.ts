import { useCallback, useEffect } from "react";
import { useAtom } from "jotai";

import { itemKeysAtom } from "../state/itemKeys";
import { fetchItemKeys, saveItemKeys } from "../utils/itemKeys";
import { getSessionAuth } from "../utils/avatarMatrix";
import { STOCK_ITEMS } from "../utils/itemsMatrix";
import { useMatrix } from "./useMatrix";
import { useMainThreadContext } from "./useMainThread";
import { Thread } from "../../engine/module/module.common";
import {
  DEFAULT_ITEM_KEYS,
  SetItemKeysMessage,
  ItemKeys,
  ThirdRoomMessageType,
} from "../../plugins/thirdroom/thirdroom.common";

const STOCK_IDS = STOCK_ITEMS.map((item) => item.id);

/**
 * Buzzar: loads your number-key Items when the session starts and keeps the game in step whenever they change.
 * Mounted once, in SessionView.
 */
export function useItemKeysSync() {
  const { session, platform, client } = useMatrix(true);
  const mainThread = useMainThreadContext();
  const [keys, setKeys] = useAtom(itemKeysAtom);

  useEffect(() => {
    let cancelled = false;
    getSessionAuth(platform, client.sessionId)
      .then((auth) => (auth ? fetchItemKeys(auth, session.userId, STOCK_IDS) : undefined))
      .then((loaded) => !cancelled && loaded && setKeys((current) => current ?? loaded))
      .catch((e) => {
        console.warn("Couldn't load your Item keys; using the defaults.", e);
        if (!cancelled) setKeys((current) => current ?? [...DEFAULT_ITEM_KEYS]);
      });
    return () => {
      cancelled = true;
    };
  }, [platform, client, session, setKeys]);

  useEffect(() => {
    if (keys)
      mainThread.sendMessage<SetItemKeysMessage>(Thread.Game, { type: ThirdRoomMessageType.SetItemKeys, keys });
  }, [mainThread, keys]);
}

/** Buzzar: changes your number-key Items (straight away in the game, then saved to your account). */
export function useSetItemKeys() {
  const { session, platform, client } = useMatrix(true);
  const [, setKeys] = useAtom(itemKeysAtom);
  return useCallback(
    async (keys: ItemKeys) => {
      setKeys(keys);
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      await saveItemKeys(auth, session.userId, keys);
    },
    [platform, client, session, setKeys]
  );
}
