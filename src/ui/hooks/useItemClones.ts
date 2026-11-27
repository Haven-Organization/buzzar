import { useCallback, useEffect, useState } from "react";
import { useAtom } from "jotai";

import { itemClonesAtom } from "../state/itemClones";
import { fetchItemClones, saveItemClones } from "../utils/itemClones";
import { getSessionAuth } from "../utils/avatarMatrix";
import { useMatrix } from "./useMatrix";
import { useMainThreadContext } from "./useMainThread";
import { getModule, registerMessageHandler, Thread } from "../../engine/module/module.common";
import {
  SetActionBarItemsMessage,
  SetCustomItemsMessage,
  SetItemClonesMessage,
  ItemClone,
  ThirdRoomMessageType,
} from "../../plugins/thirdroom/thirdroom.common";
import { ThirdroomModule } from "../../plugins/thirdroom/thirdroom.main";
import { fetchItemCollection, ItemCollection } from "../utils/itemsMatrix";
import { MainContext } from "../../engine/MainThread";
import { Session } from "../../matrix/session";

/**
 * Buzzar: loads your cloned Items when the session starts and keeps the game in step whenever they change.
 * Mounted once, in SessionView.
 */
export function useItemClonesSync() {
  const { session, platform, client } = useMatrix(true);
  const mainThread = useMainThreadContext();
  const [clones, setClones] = useAtom(itemClonesAtom);

  useEffect(() => {
    let cancelled = false;
    getSessionAuth(platform, client.sessionId)
      .then((auth) => (auth ? fetchItemClones(auth, session.userId) : undefined))
      .then((loaded) => !cancelled && loaded && setClones((current) => current ?? loaded))
      .catch((e) => {
        console.warn("Couldn't load your cloned Items.", e);
        if (!cancelled) setClones((current) => current ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [platform, client, session, setClones]);

  useEffect(() => {
    if (clones)
      mainThread.sendMessage<SetItemClonesMessage>(Thread.Game, {
        type: ThirdRoomMessageType.SetItemClones,
        clones,
      });
  }, [mainThread, clones]);
}

/** Buzzar: tells the game your own Items' names and pictures (for the action bar). */
export function sendCustomItems(mainThread: MainContext, session: Session, collection: ItemCollection) {
  mainThread.sendMessage<SetCustomItemsMessage>(Thread.Game, {
    type: ThirdRoomMessageType.SetCustomItems,
    items: collection.items.map((item) => ({
      id: item.url,
      name: item.name || "Item",
      thumbnail: item.preview_url
        ? session.mediaRepository.mxcUrlThumbnail(item.preview_url, 96, 96, "crop") ?? undefined
        : undefined,
    })),
  });
}

/**
 * Buzzar: sends your own Items to the game when the session starts, so ones on number keys have their names before
 * the Items screen is opened. Mounted once, in SessionView.
 */
export function useCustomItemsSync() {
  const { session, platform, client } = useMatrix(true);
  const mainThread = useMainThreadContext();
  useEffect(() => {
    let cancelled = false;
    getSessionAuth(platform, client.sessionId)
      .then((auth) => (auth ? fetchItemCollection(auth, session.userId) : undefined))
      .then((collection) => !cancelled && collection && sendCustomItems(mainThread, session, collection))
      .catch((e) => console.warn("Couldn't load your Items.", e));
    return () => {
      cancelled = true;
    };
  }, [platform, client, session, mainThread]);
}

/** Buzzar: changes your cloned Items (straight away in the game, then saved to your account). */
export function useSetItemClones() {
  const { session, platform, client } = useMatrix(true);
  const [, setClones] = useAtom(itemClonesAtom);
  return useCallback(
    async (clones: ItemClone[]) => {
      setClones(clones);
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      await saveItemClones(auth, session.userId, clones);
    },
    [platform, client, session, setClones]
  );
}

/** Buzzar: the stock Items the current world's rules allow (a clone is allowed when its base is). */
export function useAllowedItems(): string[] {
  const mainThread = useMainThreadContext();
  const [allowed, setAllowed] = useState<string[]>(() => getModule(mainThread, ThirdroomModule).allowedItems);
  useEffect(() => {
    setAllowed(getModule(mainThread, ThirdroomModule).allowedItems);
    return registerMessageHandler(
      mainThread,
      ThirdRoomMessageType.SetActionBarItems,
      (_ctx, message: SetActionBarItemsMessage) => message.allowedItems && setAllowed(message.allowedItems)
    );
  }, [mainThread]);
  return allowed;
}
