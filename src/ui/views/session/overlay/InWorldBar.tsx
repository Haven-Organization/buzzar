/**
 * Buzzar: a reminder across the top of the menu's full-screen windows (Worlds, Avatars, Items, Settings…) that
 * you're still in a world, where people can see and hear you, with Return and Leave World.
 */
import { Room } from "../../../../matrix";
import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { useReturnToWorld } from "../../../hooks/useReturnToWorld";
import "./InWorldBar.css";

export function InWorldBar({ world, onLeave }: { world: Room; onLeave: () => void }) {
  const returnToWorld = useReturnToWorld();
  return (
    <div className="InWorldBar flex items-center gap-sm">
      <Text variant="b3" className="grow">
        You&apos;re in <b>{world.name || "a world"}</b>. People there can still see and hear you.
      </Text>
      <Button size="sm" variant="primary" onClick={() => returnToWorld()}>
        Return
      </Button>
      <Button size="sm" variant="danger" fill="outline" onClick={onLeave}>
        Leave World
      </Button>
    </div>
  );
}
