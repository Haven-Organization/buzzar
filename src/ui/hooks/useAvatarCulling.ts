/**
 * Buzzar: feeds avatar culling (engine/avatar/avatarCulling.common.ts) to the game: the settings (Settings → Graphics),
 * and whose avatars are never hidden: friends (people you have direct messages with, from `m.direct`) and the people
 * you chose with "Show Avatar".
 */
import { useEffect, useState } from "react";
import { ClientEvent, EventType, MatrixEvent } from "matrix-js-sdk";

import { Thread } from "../../engine/module/module.common";
import {
  ALWAYS_SHOW_AVATARS_KEY,
  AVATAR_CULLING_KEY,
  AvatarCullingMessage,
  AvatarCullingMessageType,
  DEFAULT_AVATAR_CULLING,
  parseAvatarCulling,
  parseUserIdList,
} from "../../engine/avatar/avatarCulling.common";
import { useLocalStorage } from "./useLocalStorage";
import { useMainThreadContext } from "./useMainThread";
import { useMatrix } from "./useMatrix";

/** The people you have direct messages with (your account's `m.direct`), kept up to date. */
export function useFriendIds(): string[] {
  const { session } = useMatrix(true);
  const client = session.client;
  const read = () =>
    Object.keys(client.getAccountData(EventType.Direct)?.getContent() ?? {}).filter((id) => id.startsWith("@"));
  const [friends, setFriends] = useState(read);
  useEffect(() => {
    setFriends(read());
    const onAccountData = (event: MatrixEvent) => {
      if (event.getType() === EventType.Direct) setFriends(read());
    };
    client.on(ClientEvent.AccountData, onAccountData);
    return () => {
      client.off(ClientEvent.AccountData, onAccountData);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  return friends;
}

export function useAvatarCulling() {
  const mainThread = useMainThreadContext();
  const [stored] = useLocalStorage<unknown>(AVATAR_CULLING_KEY, DEFAULT_AVATAR_CULLING);
  const [overrides] = useLocalStorage<unknown>(ALWAYS_SHOW_AVATARS_KEY, []);
  const friends = useFriendIds();

  const settings = parseAvatarCulling(stored);
  const alwaysShow = [
    ...(settings.alwaysShowFriends ? friends : []),
    ...(settings.allowOverride ? parseUserIdList(overrides) : []),
  ];
  const key = JSON.stringify([settings, alwaysShow]);

  useEffect(() => {
    mainThread.sendMessage<AvatarCullingMessageType>(Thread.Game, {
      type: AvatarCullingMessage,
      settings,
      alwaysShow,
    });
    // `key` stands for settings and alwaysShow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainThread, key]);
}
