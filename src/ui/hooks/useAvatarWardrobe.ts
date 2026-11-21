/**
 * Buzzar: your avatars and what you're wearing, with the actions on them (wear, bookmark, …). Shared by the Avatars
 * screen and avatar details pages.
 */
import { useCallback, useEffect, useState } from "react";
import { useAtomValue } from "jotai";

import { useMatrix } from "./useMatrix";
import {
  AvatarCollection,
  AvatarContent,
  fetchAvatarCollection,
  fetchProfileAvatar,
  fetchWorldAvatar,
  getSessionAuth,
  MatrixAuth,
  removeFromAvatarCollection,
  saveToAvatarCollection,
  setProfileAvatar,
  setWorldAvatar,
  uploadMedia,
} from "../utils/avatarMatrix";
import { refreshWorldAvatar } from "../../engine/avatar/avatar.main";
import { worldAtom } from "../state/world";

export interface Wearing {
  profile?: AvatarContent;
  world?: AvatarContent;
}

/** Only the avatar fields (bookmarks also carry added_ts). */
export function stripSaved(avatar: AvatarContent): AvatarContent {
  const out: AvatarContent = { url: avatar.url };
  if (avatar.preview_url) out.preview_url = avatar.preview_url;
  if (avatar.format) out.format = avatar.format;
  if (avatar.name) out.name = avatar.name;
  return out;
}

export function useAvatarWardrobe() {
  const { session, platform, client, profileRoom } = useMatrix(true);
  const { worldId, entered } = useAtomValue(worldAtom);
  const inWorld = entered && !!worldId;

  const [collection, setCollection] = useState<AvatarCollection>();
  const [wearing, setWearing] = useState<Wearing>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const getAuth = useCallback(async () => {
    const auth = await getSessionAuth(platform, client.sessionId);
    if (!auth) throw new Error("Not signed in");
    return auth;
  }, [platform, client]);

  const reload = useCallback(async () => {
    try {
      const auth = await getAuth();
      const [loaded, profile, worldAvatar] = await Promise.all([
        fetchAvatarCollection(auth, session.userId).catch(() => undefined),
        fetchProfileAvatar(auth, session.userId).catch(() => undefined),
        inWorld ? fetchWorldAvatar(auth, worldId!, session.userId).catch(() => undefined) : undefined,
      ]);
      if (loaded) setCollection(loaded);
      setWearing({ profile, world: worldAvatar });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [getAuth, session, inWorld, worldId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** What you look like here: this world's own choice, else your default. */
  const current = wearing?.world ?? wearing?.profile;

  /**
   * Wear an avatar. "everywhere": your default (profile) and this world; "world": just this world.
   * `content` undefined = the built-in default rig.
   */
  const wear = async (
    key: string,
    scope: "everywhere" | "world",
    getContent: (auth: MatrixAuth) => Promise<AvatarContent | undefined>
  ) => {
    setBusy(key);
    setError(undefined);
    try {
      const auth = await getAuth();
      const content = await getContent(auth);
      if (scope === "everywhere") {
        await setProfileAvatar(auth, session.userId, content);
        // Keep Third Room's legacy (private) profile state in sync for compatibility, when that room exists.
        if (profileRoom && content) {
          await session.hsApi.sendState(profileRoom.id, "org.matrix.msc3815.world.profile", "", {
            avatar_url: content.url,
            avatar_preview_url: content.preview_url,
          });
        }
      }
      if (inWorld) {
        await setWorldAvatar(auth, worldId!, session.userId, scope === "world" ? content : undefined);
        refreshWorldAvatar(session.userId);
      }
      setWearing((w) => ({
        profile: scope === "everywhere" ? content : w?.profile,
        world: scope === "world" ? content : undefined,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const clearWorldChoice = async () => {
    setBusy("clear-world");
    setError(undefined);
    try {
      const auth = await getAuth();
      await setWorldAvatar(auth, worldId!, session.userId, undefined);
      refreshWorldAvatar(session.userId);
      setWearing((w) => ({ ...w, world: undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const bookmark = async (avatar: AvatarContent) => {
    setError(undefined);
    try {
      const auth = await getAuth();
      setCollection(await saveToAvatarCollection(auth, session.userId, avatar));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const unbookmark = async (url: string) => {
    setError(undefined);
    try {
      const auth = await getAuth();
      setCollection(await removeFromAvatarCollection(auth, session.userId, url));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** A rendered preview of one of your own avatars: upload it and remember it (and on your profile if worn). */
  const savePreview = useCallback(
    async (avatar: AvatarContent, image: Blob) => {
      const auth = await getAuth();
      const previewUrl = await uploadMedia(auth, image, "avatar-preview.png");
      const content: AvatarContent = { ...stripSaved(avatar), preview_url: previewUrl };
      setCollection(await saveToAvatarCollection(auth, session.userId, content));
      const profile = await fetchProfileAvatar(auth, session.userId).catch(() => undefined);
      if (profile?.url === avatar.url && !profile.preview_url) {
        await setProfileAvatar(auth, session.userId, { ...profile, preview_url: previewUrl });
        setWearing((w) => (w ? { ...w, profile: { ...profile, preview_url: previewUrl } } : w));
      }
    },
    [getAuth, session]
  );

  const isBookmarked = (url: string) => !!collection?.avatars.some((a) => a.url === url);
  const isWearing = (url: string | undefined) => (url ? current?.url === url : !!wearing && !current);
  const wearingWorldOnly = inWorld && wearing?.world && wearing.world.url !== wearing.profile?.url;

  return {
    collection,
    wearing,
    current,
    busy,
    error,
    inWorld,
    worldId,
    wearingWorldOnly,
    reload,
    wear,
    clearWorldChoice,
    bookmark,
    unbookmark,
    savePreview,
    isBookmarked,
    isWearing,
  };
}

export type AvatarWardrobe = ReturnType<typeof useAvatarWardrobe>;
