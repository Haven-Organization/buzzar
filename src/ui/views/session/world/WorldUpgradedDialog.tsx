import { useEffect, useState } from "react";
import { Room } from "@thirdroom/hydrogen-view-sdk";
import { useSetAtom } from "jotai";

import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { AlertDialog } from "../dialogs/AlertDialog";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { useTombstone } from "../../../hooks/useTombstone";
import { useDisableInput } from "../../../hooks/useDisableInput";
import { useWorldNavigator } from "../../../hooks/useWorldNavigator";
import { useWorldLoader } from "../../../hooks/useWorldLoader";
import { overlayWorldAtom } from "../../../state/overlayWorld";
import { getSessionAuth } from "../../../utils/avatarMatrix";
import { joinUpgradedRoom } from "../../../utils/roomUpgrade";

/**
 * Buzzar: when the world you're in is upgraded (or you enter one that already was), stop the player and offer
 * to join the replacement room and enter its world in one step.
 */
export function WorldUpgradedDialog({ world }: { world: Room }) {
  const { session, platform, client } = useHydrogen(true);
  const tombstone = useTombstone(world);
  const [dismissed, setDismissed] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { navigateEnterWorld } = useWorldNavigator(session);
  const { exitWorld } = useWorldLoader();
  const selectWorld = useSetAtom(overlayWorldAtom);

  const open = !!tombstone && dismissed !== tombstone.replacementRoom;
  // Stop the player in place (and release the mouse) while the dialog is up.
  useDisableInput(open);
  useEffect(() => setError(undefined), [tombstone]);

  const go = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      const next = await joinUpgradedRoom(session, auth, world);
      if ((await next.getStateEvent("org.matrix.msc3815.world"))?.event.content === undefined) {
        throw new Error(
          "Joined the new room, but it doesn't have a world scene yet. Ask the world's owner to set one."
        );
      }
      selectWorld(next.id);
      exitWorld();
      navigateEnterWorld(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!tombstone) return null;

  return (
    <AlertDialog
      open={open}
      title="This World Has Been Upgraded"
      closeable={false}
      requestClose={() => {}}
      content={
        <div className="flex flex-column gap-xs">
          <Text variant="b2">
            {world.name || "This world"} has moved to a new room. Everyone continues there, and chat here is closed.
          </Text>
          {tombstone.body && (
            <Text variant="b3" color="surface-low">
              “{tombstone.body}”
            </Text>
          )}
          {error && (
            <Text variant="b3" color="danger">
              {error}
            </Text>
          )}
        </div>
      }
      buttons={
        <>
          <Button disabled={busy} onClick={go}>
            {busy ? "Joining…" : "Join and Go to the New World"}
          </Button>
          <Button fill="outline" disabled={busy} onClick={() => setDismissed(tombstone.replacementRoom)}>
            Stay Here for Now
          </Button>
        </>
      }
    />
  );
}
