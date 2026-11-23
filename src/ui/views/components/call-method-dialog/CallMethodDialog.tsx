/**
 * Buzzar: "Which call?" A world's call can be carried two ways (src/matrix/callMethod.ts), and players only see and
 * hear the others in the same call. When someone enters a world whose open call isn't the method the world recommends
 * (or there are calls of both kinds), this asks which one to join: each open call with who's in it, and the
 * recommended method. Mounted once in the session; the world loader asks through setCallMethodChooser.
 */
import { useEffect, useState } from "react";

import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { useDisableInput } from "../../../hooks/useDisableInput";
import { useMatrix } from "../../../hooks/useMatrix";
import { AlertDialog } from "../../session/dialogs/AlertDialog";
import { CALL_METHOD_LABEL, CallMethod, CallMethodDecision, setCallMethodChooser } from "../../../../matrix";

interface Pending {
  world: { id: string; name: string; preferredFrom: "world" | "setting" };
  decision: Extract<CallMethodDecision, { kind: "ask" }>;
  resolve: (method: CallMethod | undefined) => void;
}

/** "Alice, Bob and 3 others" (each device counts once per person). */
function playerList(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 3) {
    return unique.length <= 1 ? unique.join("") : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
  }
  return `${unique.slice(0, 2).join(", ")} and ${unique.length - 2} others`;
}

export function CallMethodDialogHost() {
  const { session } = useMatrix(true);
  const [pending, setPending] = useState<Pending>();
  useDisableInput(!!pending);

  useEffect(() => {
    setCallMethodChooser(
      (world, decision) =>
        new Promise((resolve) => {
          if (document.pointerLockElement) document.exitPointerLock();
          setPending({ world, decision, resolve });
        })
    );
    return () => setCallMethodChooser(undefined);
  }, []);

  if (!pending) return null;
  const { world, decision } = pending;
  const fromSetting = world.preferredFrom === "setting";
  const room = session.rooms.get(world.id);
  const nameOf = (userId: string) => room?.getMember(userId)?.name ?? userId;
  const settle = (method: CallMethod | undefined) => {
    setPending(undefined);
    pending.resolve(method);
  };

  return (
    <AlertDialog
      open
      title="Which call?"
      requestClose={() => settle(undefined)}
      content={
        <div className="flex flex-column gap-sm">
          <Text variant="b2">
            {decision.options.filter((o) => o.players.length > 0).length > 1
              ? `${world.name} has calls of two kinds open. `
              : fromSetting
              ? `${world.name} has a call open that isn't the kind your developer setting asks for. `
              : `${world.name} has a call open that doesn't use the kind of call this world recommends. `}
            You'll only see and hear the players in the call you join: players in the other kind of call won&apos;t
            appear for you, and you won&apos;t appear for them.
          </Text>
          <Text variant="b3" color="surface-low">
            {fromSetting ? "Your developer setting" : "Recommended for this world"}:{" "}
            {CALL_METHOD_LABEL[decision.preferred]}.
          </Text>
        </div>
      }
      buttons={
        <>
          {decision.options.map((option) => (
            <Button
              key={option.method}
              variant={option.method === decision.preferred ? "primary" : "secondary"}
              fill={option.method === decision.preferred ? "solid" : "outline"}
              onClick={() => settle(option.method)}
            >
              {option.players.length > 0
                ? `Join the ${CALL_METHOD_LABEL[option.method]} call (${playerList(option.players.map(nameOf))})`
                : `Start a ${CALL_METHOD_LABEL[option.method]} call (${fromSetting ? "your setting" : "recommended"})`}
            </Button>
          ))}
          <Button variant="secondary" fill="none" onClick={() => settle(undefined)}>
            Cancel
          </Button>
        </>
      }
    />
  );
}
