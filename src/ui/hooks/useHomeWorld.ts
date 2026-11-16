import { RoomBeingCreated, RoomType, RoomVisibility, Session } from "@thirdroom/hydrogen-view-sdk";
import { useEffect, useState } from "react";

import defaultWorlds from "../../../res/defaultWorlds.json";
import { getSessionAuth, MatrixAuth } from "../utils/avatarMatrix";
import { getJoinedRoomIds, WORLD_ROOM_TYPE } from "../utils/buzzarSpace";
import { uploadBundledFile } from "../utils/bundledMedia";
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

/** Resolves with the new room's ID once the server has created it; rejects if creation failed. */
export function waitForCreatedRoomId(roomBeingCreated: RoomBeingCreated): Promise<string> {
  return new Promise((resolve, reject) => {
    // `check` only runs after `unsubscribe` is assigned (on "change", and the explicit call below).
    const check = () => {
      if (roomBeingCreated.error) {
        unsubscribe();
        reject(roomBeingCreated.error);
      } else if (roomBeingCreated.roomId) {
        unsubscribe();
        resolve(roomBeingCreated.roomId);
      }
    };
    const unsubscribe = roomBeingCreated.disposableOn("change", check);
    check();
  });
}

const homeWorldRuns = new WeakMap<Session, Promise<void>>();

/**
 * A Home World the user already has but whose account data pointer was never saved (see `waitForCreatedRoomId`):
 * the newest joined world named "Home World" that the user created with `home: true`. Reused instead of creating
 * yet another one.
 */
async function findOrphanHomeWorld(session: Session): Promise<HomeWorldAccountData | undefined> {
  let best: { id: string; ts: number; version: number } | undefined;
  for (const room of session.rooms.values()) {
    if (room.type !== WORLD_ROOM_TYPE || room.name !== "Home World") continue;
    const [world, create] = await Promise.all([
      room.getStateEvent("org.matrix.msc3815.world", ""),
      room.getStateEvent("m.room.create", ""),
    ]);
    if (world?.event.content?.home !== true || create?.event.sender !== session.userId) continue;
    const ts = create.event.origin_server_ts ?? 0;
    const version = typeof world.event.content.version === "number" ? world.event.content.version : 4;
    if (!best || ts > best.ts) best = { id: room.id, ts, version: Math.max(4, version) };
  }
  return best && { version: best.version, room_id: best.id };
}

export function useHomeWorld() {
  const { session, platform, client } = useHydrogen(true);
  const [homeWorldId, setHomeWorldId] = useState<string>();

  useEffect(() => {
    async function run() {
      let homeAccountData = (await session.getAccountData("org.matrix.msc3815.world.home")) as
        | HomeWorldAccountData
        | undefined;
      const auth = () =>
        getSessionAuth(platform, client.sessionId).then((a) => {
          if (!a) throw new Error("No session credentials to upload the Home World");
          return a;
        });

      // The room may not have arrived through sync yet right after it was created; ask the server too.
      const isJoined = async (roomId: string) =>
        !!session.rooms.get(roomId) || (await getJoinedRoomIds(await auth())).has(roomId);

      if (!homeAccountData?.room_id || !homeAccountData.version || homeAccountData.version < 4) {
        const orphan = await findOrphanHomeWorld(session);
        if (orphan) {
          homeAccountData = orphan;
          await session.setAccountData("org.matrix.msc3815.world.home", homeAccountData);
        }
      }

      if (
        homeAccountData &&
        homeAccountData.version &&
        homeAccountData.version >= 4 &&
        (await isJoined(homeAccountData.room_id))
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
        // Save the pointer as soon as the server has created the room. Waiting for the room to show up in sync
        // first used to fail on slower homeservers, so every reload created another Home World.
        const roomId = await waitForCreatedRoomId(roomBeingCreated);
        await session.setAccountData("org.matrix.msc3815.world.home", {
          version: defaultWorlds.home.version,
          room_id: roomId,
        });
        setHomeWorldId(roomId);
      }
    }

    // One run at a time per session (React may run effects twice), so two Home Worlds can't be created at once.
    homeWorldRuns.set(session, (homeWorldRuns.get(session) ?? Promise.resolve()).then(run).catch(console.error));
  }, [session, platform, client]);

  return homeWorldId;
}
