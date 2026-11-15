import { RoomType, RoomVisibility, Session } from "@thirdroom/hydrogen-view-sdk";
import { useEffect, useState } from "react";

import defaultWorlds from "../../../res/defaultWorlds.json";
import { getSessionAuth, MatrixAuth } from "../utils/avatarMatrix";
import { uploadBundledFile } from "../utils/bundledMedia";
import { waitToCreateRoom } from "../utils/matrixUtils";
import { useHydrogen } from "./useHydrogen";

/**
 * Buzzar: the default Home World ships with the app (public/worlds/home) and is uploaded to the user's own
 * homeserver when their Home World is created or upgraded. Upstream pointed at mxc://thirdroom.io media, which
 * homeservers that can't fetch from thirdroom.io (e.g. glowers.club) couldn't load at all.
 */
interface HomeWorldMedia {
  sceneUrl: string;
  scenePreviewUrl: string;
  avatar: { url: string; info: { w: number; h: number; mimetype: string; size: number } };
}

async function uploadHomeWorldMedia(auth: MatrixAuth): Promise<HomeWorldMedia> {
  const { home } = defaultWorlds;
  const [scene, preview, avatar] = await Promise.all([
    uploadBundledFile(auth, home.sceneUrl),
    uploadBundledFile(auth, home.scenePreviewUrl),
    uploadBundledFile(auth, home.defaultAvatar.url),
  ]);
  return {
    sceneUrl: scene.url,
    scenePreviewUrl: preview.url,
    avatar: { url: avatar.url, info: { ...home.defaultAvatar.info, size: avatar.size } },
  };
}

async function createHomeWorld(session: Session, media: HomeWorldMedia) {
  return await session.createRoom({
    type: RoomType.World,
    visibility: RoomVisibility.Private,
    avatar: media.avatar,
    name: "Home World",
    isEncrypted: false,
    isFederationDisabled: false,
    powerLevelContentOverride: {
      invite: 100,
      kick: 100,
      ban: 100,
      redact: 100,
      state_default: 100,
      events_default: 100,
      users_default: 0,
      events: {
        "m.room.power_levels": 100,
        "m.room.history_visibility": 100,
        "m.room.tombstone": 100,
        "m.room.encryption": 100,
        "m.room.name": 100,
        "m.room.message": 0,
        "m.room.encrypted": 100,
        "m.sticker": 0,
        "org.matrix.msc3401.call.member": 0,
        "org.matrix.msc3815.member.world": 0,
      },
      // Buzzar: no `users` entry. The server already gives the creator PL 100, and room v12 (matrix.org's
      // current default) rejects power levels that list a creator.
    },
    initialState: [
      {
        type: "org.matrix.msc3815.world",
        content: {
          version: defaultWorlds.home.version,
          scene_url: media.sceneUrl,
          scene_preview_url: media.scenePreviewUrl,
          home: true,
        },
      },
    ],
  });
}

interface HomeWorldAccountData {
  version?: number;
  room_id: string;
}

async function updateHomeWorld(session: Session, accountData: HomeWorldAccountData, media: HomeWorldMedia) {
  const room = session.rooms.get(accountData.room_id);

  if (!room) {
    throw new Error("Home world not found");
  }

  await session.hsApi
    .sendState(room.id, "org.matrix.msc3815.world", "", {
      version: defaultWorlds.home.version,
      scene_url: media.sceneUrl,
      scene_preview_url: media.scenePreviewUrl,
      home: true,
    })
    .response();
  await session.hsApi.sendState(room.id, "m.room.avatar", "", media.avatar).response();
}

export function useHomeWorld() {
  const { session, platform, client } = useHydrogen(true);
  const [homeWorldId, setHomeWorldId] = useState<string>();

  useEffect(() => {
    async function run() {
      const homeAccountData = await session.getAccountData("org.matrix.msc3815.world.home");
      const auth = () =>
        getSessionAuth(platform, client.sessionId).then((a) => {
          if (!a) throw new Error("No session credentials to upload the Home World");
          return a;
        });

      if (
        homeAccountData &&
        homeAccountData.version &&
        homeAccountData.version >= 4 &&
        session.rooms.get(homeAccountData.room_id)
      ) {
        // Enter the existing Home World right away; upgrade its scene in the background.
        setHomeWorldId(homeAccountData.room_id);

        if (homeAccountData.version < defaultWorlds.home.version) {
          await updateHomeWorld(session, homeAccountData, await uploadHomeWorldMedia(await auth()));

          await session.setAccountData("org.matrix.msc3815.world.home", {
            version: defaultWorlds.home.version,
            room_id: homeAccountData.room_id,
          });
        }
      } else {
        if (homeAccountData && homeAccountData.version && homeAccountData.version <= 3) {
          await session.rooms.get(homeAccountData.room_id)?.leave();
        }

        const roomBeingCreated = await createHomeWorld(session, await uploadHomeWorldMedia(await auth()));
        const homeWorld = await waitToCreateRoom(session, roomBeingCreated);
        setHomeWorldId(homeWorld!.id);

        await session.setAccountData("org.matrix.msc3815.world.home", {
          version: defaultWorlds.home.version,
          room_id: homeWorld!.id,
        });
      }
    }

    run().catch(console.error);
  }, [session, platform, client]);

  return homeWorldId;
}
