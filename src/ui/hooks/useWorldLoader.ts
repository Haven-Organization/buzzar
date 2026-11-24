import { useSetAtom } from "jotai";
import { useCallback } from "react";

import { Room, Content, markStartup } from "../../matrix";
import { AudioModule } from "../../engine/audio/audio.main";
import { disposeActiveMatrixRoom, setActiveMatrixRoom } from "../../engine/matrix/matrix.main";
import { getModule } from "../../engine/module/module.common";
import {
  CallChoiceCancelled,
  createMatrixNetworkInterface,
  registerMatrixNetworkInterface,
  provideMatrixNetworkInterface,
} from "../../engine/network/createMatrixNetworkInterface";
import { enterWorld, loadWorld, reloadWorld } from "../../plugins/thirdroom/thirdroom.main";
import { worldAtom } from "../state/world";
import { makeWorldNotice, worldNoticeAtom } from "../state/worldNotice";
import { scriptPolicy, takeEnterWithoutScript } from "../utils/scriptSettings";
import {
  liveKitMembershipKeyPrefix,
  removeStaleCallMemberships,
  removeStaleLiveKitMemberships,
} from "../utils/callCleanup";
import { useMatrix } from "./useMatrix";
import { useMainThreadContext } from "./useMainThread";
import { Thread } from "../../engine/module/module.common";
import { getSessionAuth } from "../utils/avatarMatrix";
import { WORLD_RULES_EVENT } from "../../engine/network/spawnRules.common";
import { setWorldShadows, waitForShadersSettled } from "../../engine/renderer/renderer.main";
import { parseWorldShadows } from "../../engine/renderer/renderer.common";
import { MediaConfigMessage, MediaConfigMessageType } from "../../engine/avatar/avatar.common";

/** The world being visited without its script ("Enter Without Script"), if any. */
let visitWithoutScript: string | undefined;

export interface WorldLoader {
  loadAndEnterWorld: (
    world: Room,
    content: Content,
    options?: {
      reload?: boolean;
      /** The instance to join (src/matrix/instances.ts): an instance ID, or "new". */
      instance?: string;
    }
  ) => Promise<void>;
  reloadWorld: (world: Room, content: Content) => Promise<void>;
  exitWorld: () => void;
}

export function useWorldLoader(): WorldLoader {
  const { session, platform, client } = useMatrix(true);
  const mainThread = useMainThreadContext();
  const setWorld = useSetAtom(worldAtom);
  const setWorldNotice = useSetAtom(worldNoticeAtom);

  const exitWorldCallback = useCallback(async () => {
    provideMatrixNetworkInterface((matrixNetworkInterface) => {
      matrixNetworkInterface?.dispose();
    });

    disposeActiveMatrixRoom(mainThread);

    setWorld({ type: "CLOSE" });
  }, [setWorld, mainThread]);

  const loadAndEnterWorldCallback = useCallback(
    async (world: Room, content: Content, options?: { instance?: string }) => {
      const roomId = world.id;

      markStartup("world load started");
      setWorld({ type: "LOAD", roomId });

      // Buzzar: "Enter Without Script" lasts for this visit (scene/script reloads included), not beyond it.
      const skipScript = takeEnterWithoutScript(roomId);
      visitWithoutScript = skipScript ? roomId : undefined;

      const maxObjectCap = content.max_member_object_cap;
      let environmentUrl = content.scene_url;
      let environmentScriptUrl = content.script_url;

      if (typeof environmentUrl !== "string") {
        throw new Error("3D scene does not exist for this world.");
      }

      // Buzzar: the visitor's script settings (scripts off, or a web-hosted script without permission).
      const publishedScriptUrl = typeof content.script_url === "string" ? content.script_url : undefined;
      if (environmentScriptUrl) {
        const policy = scriptPolicy(environmentScriptUrl, skipScript);
        if (!policy.run) {
          environmentScriptUrl = undefined;
          setWorldNotice(
            makeWorldNotice(
              policy.reason === "disabled"
                ? "World scripts are turned off in your settings, so this world's script wasn't run."
                : policy.reason === "skipped"
                ? "You entered without this world's script. Enter again normally to run it."
                : "This world's script is on a web address, which would reveal your IP to that site, so it wasn't run. You can allow web-hosted scripts in Settings."
            )
          );
        }
      }

      if (environmentUrl.startsWith("mxc:")) {
        environmentUrl = session.mediaRepository.mxcUrl(environmentUrl)!;
      }

      if (environmentScriptUrl && environmentScriptUrl.startsWith("mxc:")) {
        environmentScriptUrl = session.mediaRepository.mxcUrl(environmentScriptUrl)!;
      }

      let networkPromise: ReturnType<typeof createMatrixNetworkInterface> | undefined;
      try {
        setActiveMatrixRoom(mainThread, session, world.id, publishedScriptUrl);

        // Buzzar: the world's shadows before it first appears. Turned on later (when the world view's rules hook ran,
        // after entering), every material's shader had to be rebuilt at once: about a second's freeze, just as you
        // started looking around. The rules hook sends the same settings again, which changes nothing.
        const rules = await world.getStateEvent(WORLD_RULES_EVENT).catch(() => undefined);
        setWorldShadows(
          mainThread,
          parseWorldShadows((rules?.event.content as { shadows?: unknown } | undefined)?.shadows)
        );

        // Buzzar: lets world content (e.g. avatar pedestals) resolve mxc:// URIs. Must precede LoadWorld.
        const auth = await getSessionAuth(platform, client.sessionId);
        mainThread.sendMessage<MediaConfigMessageType>(Thread.Game, {
          type: MediaConfigMessage,
          homeserver: auth?.homeserver,
        });

        // Buzzar: if the world fails to load, still hang up the call this started (it would otherwise stay joined,
        // with your microphone attached, and the next world couldn't attach it: "Local media stream source already
        // connected").
        networkPromise = createMatrixNetworkInterface(mainThread, client, platform, world, options?.instance);
        const [matrixNetworkInterface] = await Promise.all([
          networkPromise,
          loadWorld(mainThread, environmentUrl, {
            environmentScriptUrl,
            maxObjectCap,
          }),
        ]);

        registerMatrixNetworkInterface(matrixNetworkInterface);
        networkPromise = undefined;

        await enterWorld(mainThread, session.userId);

        // Buzzar: drop this device from other worlds' calls it never left (reloads, closing the app), so people
        // don't see you in several worlds at once. Best effort, in the background.
        if (auth) {
          const deviceId = session.sessionInfo.deviceId;
          // Only rooms whose (locally synced) call state still lists this device.
          Promise.all(
            [...session.rooms.values()]
              .filter((room) => room.type === "org.matrix.msc3815.world" && room.id !== world.id)
              .map(async (room) => {
                const observable = await room.observeStateTypeAndKey("org.matrix.msc3401.call.member", session.userId);
                const content = observable.get()?.content as
                  | { "m.calls"?: { "m.devices"?: { device_id?: string }[] }[] }
                  | undefined;
                const listed = content?.["m.calls"]?.some((call) =>
                  call["m.devices"]?.some((device) => device.device_id === deviceId)
                );
                return listed ? room.id : undefined;
              })
          )
            .then((ids) => ids.filter((id): id is string => !!id))
            .then((ids) => removeStaleCallMemberships(auth, session.userId, deviceId, ids, world.id))
            .catch(() => undefined);
          // The same for LiveKit calls: our device's own membership events, still filled in, in other worlds (any
          // instance of them).
          const prefix = liveKitMembershipKeyPrefix(session.userId, deviceId);
          Promise.all(
            [...session.rooms.values()]
              .filter((room) => room.type === "org.matrix.msc3815.world" && room.id !== world.id)
              .map(async (room) => {
                const events = await room.observeStateType("org.matrix.msc3401.call.member");
                return [...events]
                  .filter(([key, event]) => key.startsWith(prefix) && Object.keys(event.content ?? {}).length > 0)
                  .map(([key]) => ({ roomId: room.id, key }));
              })
          )
            .then((lists) => removeStaleLiveKitMemberships(auth, lists.flat()))
            .catch(() => undefined);
        }

        // Buzzar: the loading card stays up while the world's shaders compile (compiling stalls drawing, which
        // felt like a second of jittery mouse look just after entering).
        await waitForShadersSettled(mainThread);
        markStartup("shaders ready");

        const audio = getModule(mainThread, AudioModule);
        audio.context.resume().catch(() => console.error("Couldn't resume audio context"));

        markStartup("in world");
        setWorld({ type: "ENTER" });
      } catch (err: any) {
        networkPromise?.then((network) => network.dispose()).catch(() => undefined);
        // Buzzar: cancelling the "which call?" question isn't an error to show.
        if (err instanceof CallChoiceCancelled) throw err;
        throw new Error(err?.message ?? "Unknown error loading world.");
      }
    },
    [mainThread, session, setWorld, client, platform, setWorldNotice]
  );

  // keeps the call established and reloads the scene/script
  const reloadWorldCallback = useCallback(
    async (world: Room, content: Content) => {
      setWorld({ type: "LOAD", roomId: world.id });

      disposeActiveMatrixRoom(mainThread);

      const maxObjectCap = content.max_member_object_cap;
      let environmentUrl = content.scene_url;
      let environmentScriptUrl = content.script_url;

      if (typeof environmentUrl !== "string") {
        throw new Error("3D scene does not exist for this world.");
      }

      // Buzzar: the visitor's script settings (scripts off, or a web-hosted script without permission).
      const publishedScriptUrl = typeof content.script_url === "string" ? content.script_url : undefined;
      if (environmentScriptUrl) {
        const policy = scriptPolicy(environmentScriptUrl, visitWithoutScript === world.id);
        if (!policy.run) {
          environmentScriptUrl = undefined;
          setWorldNotice(
            makeWorldNotice(
              policy.reason === "disabled"
                ? "World scripts are turned off in your settings, so this world's script wasn't run."
                : policy.reason === "skipped"
                ? "You entered without this world's script. Enter again normally to run it."
                : "This world's script is on a web address, which would reveal your IP to that site, so it wasn't run. You can allow web-hosted scripts in Settings."
            )
          );
        }
      }

      setActiveMatrixRoom(mainThread, session, world.id, publishedScriptUrl);

      if (environmentUrl.startsWith("mxc:")) {
        environmentUrl = session.mediaRepository.mxcUrl(environmentUrl)!;
      }

      if (environmentScriptUrl && environmentScriptUrl.startsWith("mxc:")) {
        environmentScriptUrl = session.mediaRepository.mxcUrl(environmentScriptUrl)!;
      }

      await reloadWorld(mainThread, environmentUrl, {
        environmentScriptUrl,
        maxObjectCap,
      });

      setWorld({ type: "ENTER" });
    },
    [setWorld, mainThread, session, setWorldNotice]
  );

  return {
    loadAndEnterWorld: loadAndEnterWorldCallback,
    exitWorld: exitWorldCallback,
    reloadWorld: reloadWorldCallback,
  };
}
