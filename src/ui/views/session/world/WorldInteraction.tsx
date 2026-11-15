import { GroupCall, Room, Session } from "@thirdroom/hydrogen-view-sdk";
import { useSetAtom } from "jotai";
import { useCallback, useState } from "react";

import { InteractableType } from "../../../../engine/resource/schema";
import { InteractableAction } from "../../../../plugins/interaction/interaction.common";
import { useIsMounted } from "../../../hooks/useIsMounted";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { useMemoizedState } from "../../../hooks/useMemoizedState";
import { overlayWorldAtom } from "../../../state/overlayWorld";
import { aliasToRoomId, getMxIdUsername, parseMatrixUri } from "../../../utils/matrixUtils";
import { InteractionState, useWorldInteraction } from "../../../hooks/useWorldInteraction";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { EntityTooltip } from "../entity-tooltip/EntityTooltip";
import { MemberListDialog } from "../dialogs/MemberListDialog";
import { getModule } from "../../../../engine/module/module.common";
import { PlayerModule } from "../../../../engine/player/Player.main";
import { Reticle } from "../reticle/Reticle";
import { useWorldNavigator } from "../../../hooks/useWorldNavigator";
import { useWorldLoader } from "../../../hooks/useWorldLoader";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { getSessionAuth } from "../../../utils/avatarMatrix";
import { waitForJoinedRoom } from "../../../utils/roomUpgrade";
import { joinRoomVia, MatrixRequestError, serverNameOf } from "../../../utils/worldDirectory";

const MAX_TOMBSTONE_HOPS = 3;

/**
 * Buzzar: a portal to a web page used to replace the whole app with that page, silently. A world can put any link
 * in a portal, so ask first (with a browser dialog the world can't draw over) and open it in a new tab.
 */
function openExternalPortal(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Portals can't open ${url.protocol} links.`);
  }
  document.exitPointerLock();
  const ok = window.confirm(`This portal leads to a website outside Buzzar:\n\n${url.href}\n\nOpen it in a new tab?`);
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
  activeCall?: GroupCall;
}

export function WorldInteraction({ session, world, activeCall }: WorldInteractionProps) {
  const mainThread = useMainThreadContext();
  const { platform, client } = useHydrogen(true);
  const camRigModule = getModule(mainThread, PlayerModule);

  const [activeEntity, setActiveEntity] = useMemoizedState<InteractionState | undefined>();
  const [portalProcess, setPortalProcess] = useMemoizedState<IPortalProcess>({});
  const [members, setMembers] = useState(false);

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
          openExternalPortal(parsedUri);
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
          setMembers(true);
          document.exitPointerLock();
          return;
        }
        if (interactableType === InteractableType.Portal) {
          handlePortalGrab(interaction);
          return;
        }
      }

      if (interactableType === InteractableType.Player) {
        const entity: InteractionState = {
          ...interaction,
          name: peerId ? activeCall?.members.get(peerId)?.member.displayName || getMxIdUsername(peerId) : "Player",
        };
        setActiveEntity(entity);
      }

      setActiveEntity(interaction);
    },
    [handlePortalGrab, setActiveEntity, activeCall]
  );

  useWorldInteraction(mainThread, handleInteraction);

  return (
    <div>
      {!("isBeingCreated" in world) && (
        <Dialog open={members} onOpenChange={setMembers}>
          <MemberListDialog room={world} requestClose={() => setMembers(false)} />
        </Dialog>
      )}
      {!camRigModule.orbiting && <Reticle />}
      {activeEntity && !camRigModule.orbiting && (
        <EntityTooltip activeEntity={activeEntity} portalProcess={portalProcess} />
      )}
    </div>
  );
}
