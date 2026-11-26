/** Buzzar: the "Still there?" question before leaving a world you've been away from (hooks/useIdleLeave.ts). */
import { useCallback } from "react";

import { Room } from "../../../../matrix";
import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { useMatrix } from "../../../hooks/useMatrix";
import { useIdleLeave } from "../../../hooks/useIdleLeave";
import { useWorldNavigator } from "../../../hooks/useWorldNavigator";
import { AlertDialog } from "../dialogs/AlertDialog";

export function IdleLeave({ world }: { world: Room }) {
  const { session } = useMatrix(true);
  const { navigateExitWorld } = useWorldNavigator(session);
  const leave = useCallback(() => navigateExitWorld(), [navigateExitWorld]);
  const { secondsLeft, stay, minutes } = useIdleLeave(leave);
  if (secondsLeft === undefined) return null;
  const name = world.name || "this world";
  return (
    <AlertDialog
      open
      title="Still there?"
      requestClose={stay}
      content={
        <Text variant="b2">
          You&apos;ve been away from {name} for {minutes} minutes. You&apos;ll leave it in {secondsLeft} second
          {secondsLeft === 1 ? "" : "s"}, so people there stop seeing you. You can change or turn this off in Settings →
          Worlds &amp; Scripts.
        </Text>
      }
      buttons={
        <>
          <Button variant="primary" onClick={stay}>
            Stay
          </Button>
          <Button variant="danger" fill="outline" onClick={leave}>
            Leave Now
          </Button>
        </>
      }
    />
  );
}
