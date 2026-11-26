import { useSetAtom } from "jotai";
import { useCallback } from "react";

import { Room, Session } from "../../../../matrix";
import { InteractableType } from "../../../../engine/resource/schema";
import { InteractableAction } from "../../../../plugins/interaction/interaction.common";
import { useIsMounted } from "../../../hooks/useIsMounted";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { useMemoizedState } from "../../../hooks/useMemoizedState";
import { overlayWorldAtom } from "../../../state/overlayWorld";
import { aliasToRoomId, parseMatrixUri } from "../../../utils/matrixUtils";
import { InteractionState, useWorldInteraction } from "../../../hooks/useWorldInteraction";
import { EquipCard, useEquippedThing } from "../entity-tooltip/EquipCard";
import { EntityTooltip } from "../entity-tooltip/EntityTooltip";
import { useOpenOverlayWindow } from "../../../hooks/useOpenOverlayWindow";
import { OverlayWindow } from "../../../state/overlayWindow";
import { getModule } from "../../../../engine/module/module.common";
import { PlayerModule } from "../../../../engine/player/Player.main";
import { Reticle } from "../reticle/Reticle";
import { useWorldNavigator } from "../../../hooks/useWorldNavigator";
import { useWorldLoader } from "../../../hooks/useWorldLoader";
import { useMatrix } from "../../../hooks/useMatrix";
import { useMemberDisplayName } from "../../../hooks/useMemberDisplayName";
import { getSessionAuth } from "../../../utils/avatarMatrix";
import { waitForJoinedRoom } from "../../../utils/roomUpgrade";
import { joinRoomVia, MatrixRequestError, serverNameOf } from "../../../utils/worldDirectory";
import { confirmDialog } from "../../components/confirm-dialog/ConfirmDialog";

const MAX_TOMBSTONE_HOPS = 3;

/**
 * Buzzar: a portal to a web page used to replace the whole app with that page, silently. A world can put any link
 * in a portal, so ask first (in the app's own dialog, which the world's canvas can't draw over) and open it in a new
 * tab.
 */
async function openExternalPortal(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Portals can't open ${url.protocol} links.`);
  }
  const ok = await confirmDialog({
    title: "Open Website?",
    message: `This portal leads to a website outside Buzzar:\n\n${url.href}\n\nOpen it in a new tab?`,
    confirmLabel: "Open in New Tab",
  });
  if (ok) window.open(url.href, "_blank", "noopener,noreferrer");
}

/** Explains a failed portal join in words, instead of a raw server error. */
function describePortalJoinError(err: unknown, target: string) {
  if (err instanceof MatrixRequestError) {
    if (err.errcode === "M_NOT_FOUND" || err.status === 404) {
      return new Error(`This world no longer exists (${target} couldn't be found).`);
    }
    if (err.errcode === "M_FORBIDDEN" || err.status === 403) {
      return new Error("You can't join this world. It may be invite-only, or you may be banned.");
    }
    if (err.status === 502 || err.status === 504) {
      return new Error("The server hosting this world couldn't be reached.");
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}

export interface IPortalProcess {
  joining?: boolean;
  error?: Error;
}

interface WorldInteractionProps {
  session: Session;
  world: Room;
}

export function WorldInteraction({ session, world }: WorldInteractionProps) {
  const mainThread = useMainThreadContext();
  const { platform, client } = useMatrix(true);
  const displayNameOf = useMemberDisplayName(world);
  const camRigModule = getModule(mainThread, PlayerModule);

  const [activeEntity, setActiveEntity] = useMemoizedState<InteractionState | undefined>();
  const [portalProcess, setPortalProcess] = useMemoizedState<IPortalProcess>({});
  const openOverlayWindow = useOpenOverlayWindow();

  const { navigateEnterWorld } = useWorldNavigator(session);
  const { exitWorld } = useWorldLoader();
  const selectWorld = useSetAtom(overlayWorldAtom);
  const isMounted = useIsMounted();

  const handlePortalGrab = useCallback(
    async (interaction: InteractionState) => {
      try {
        setPortalProcess({});
        const { uri } = interaction;
        if (!uri) throw Error("Portal does not have valid matrix id/alias");

        const parsedUri = parseMatrixUri(uri);
        if (parsedUri instanceof URL) {
          await openExternalPortal(parsedUri);
          return;
        }
        if (parsedUri.mxid1.startsWith("@")) throw new Error("This portal points to a person, not a world.");

        let target = parsedUri.mxid1;
        let via = parsedUri.via;
        // Follow upgraded rooms (m.room.tombstone) to their replacement, a few hops at most.
        for (let hop = 0; ; hop++) {
          const knownId = target.startsWith("#") ? aliasToRoomId(session.rooms, target) : target;
          let room = knownId ? session.rooms.get(knownId) : undefined;

          if (!room) {
            setPortalProcess({ joining: true });
            const auth = await getSessionAuth(platform, client.sessionId);
            if (!auth) throw new Error("Not signed in");
            let roomId: string;
            try {
              roomId = await joinRoomVia(auth, target, via);
            } catch (err) {
              throw describePortalJoinError(err, target);
            }
            room = await waitForJoinedRoom(
              session,
              roomId,
              "Joined, but the world took too long to load. Try again from your world list."
            );
            if (!isMounted()) return;
          }

          const tombstone = (await room.getStateEvent("m.room.tombstone"))?.event;
          const replacement = tombstone?.content?.replacement_room;
          if (typeof replacement === "string" && replacement !== room.id && hop < MAX_TOMBSTONE_HOPS) {
            target = replacement;
            via = tombstone?.sender ? [serverNameOf(tombstone.sender)] : [];
            continue;
          }

          const worldEvent = await room.getStateEvent("org.matrix.msc3815.world");
          if (!worldEvent?.event.content) throw new Error(`${room.name || target} is a chat room, not a world.`);
          if (!isMounted()) return;

          setPortalProcess({});
          selectWorld(room.id);
          exitWorld();
          navigateEnterWorld(room);
          return;
        }
      } catch (err) {
        if (!isMounted()) return;
        setPortalProcess({ error: err as Error });
      }
    },
    [session, platform, client, selectWorld, exitWorld, navigateEnterWorld, isMounted, setPortalProcess]
  );

  const handleInteraction = useCallback(
    (interaction?: InteractionState) => {
      if (!interaction) return setActiveEntity(undefined);
      const { interactableType, action, peerId } = interaction;

      if (action === InteractableAction.Grab) {
        if (interactableType === InteractableType.Player && typeof peerId === "string") {
          openOverlayWindow({ type: OverlayWindow.People, tab: "world" });
          return;
        }
        if (interactableType === InteractableType.Portal) {
          handlePortalGrab(interaction);
          return;
        }
      }

      // Buzzar: show the player's display name. (The name used to be worked out and then overwritten straight away.)
      if (interactableType === InteractableType.Player && peerId) {
        setActiveEntity({ ...interaction, name: displayNameOf(peerId) });
        return;
      }

      setActiveEntity(interaction);
    },
    [handlePortalGrab, setActiveEntity, displayNameOf, openOverlayWindow]
  );

  useWorldInteraction(mainThread, handleInteraction);
  // Buzzar: a Thing's controls for a few seconds after you pick it up (in the hover card's place).
  const equipped = useEquippedThing();

  return (
    <div>
      {!camRigModule.orbiting && <Reticle />}
      {equipped && !camRigModule.orbiting && <EquipCard key={equipped.at} equipped={equipped} />}
      {activeEntity && !equipped && !camRigModule.orbiting && (
        <EntityTooltip activeEntity={activeEntity} portalProcess={portalProcess} />
      )}
    </div>
  );
}
