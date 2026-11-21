import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";

import { getSessionAuth } from "../utils/avatarMatrix";
import { syncBuzzarSpace, WORLD_ROOM_TYPE } from "../utils/buzzarSpace";
import { useMatrix } from "./useMatrix";
import { worldAtom } from "../state/world";

/** Re-sync at most this often while rooms change (joining a world adds a room; leaving removes one). */
const SYNC_DELAY_MS = 5_000;

/**
 * Buzzar: keeps the user's personal "Buzzar" space listing the worlds they're in (see utils/buzzarSpace.ts).
 * Runs once after sign-in, then whenever the room list changes. Does nothing if the user turned it off. A user who
 * has no space yet gets one when they first enter a world, with all their worlds added.
 */
export function useBuzzarSpace() {
  const { session, platform, client } = useMatrix(true);
  const { entered } = useAtomValue(worldAtom);
  // Once a world has been entered this session, the space may be created.
  const hasEntered = useRef(false);
  if (entered) hasEntered.current = true;

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let running = false;
    let again = false;

    const run = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        const auth = await getSessionAuth(platform, client.sessionId);
        if (!auth || disposed) return;
        const worldIds = Array.from(session.rooms.values())
          .filter((room) => room.type === WORLD_ROOM_TYPE)
          .map((room) => room.id);
        const result = await syncBuzzarSpace(auth, session.userId, worldIds, { create: hasEntered.current });
        if (result && (result.add.length || result.remove.length)) {
          console.info(`Buzzar space: added ${result.add.length}, removed ${result.remove.length} worlds`);
        }
      } catch (error) {
        console.warn("Couldn't update the Buzzar space", error);
      } finally {
        running = false;
        if (again && !disposed) {
          again = false;
          schedule();
        }
      }
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, SYNC_DELAY_MS);
    };

    schedule();
    // The room list reports every kind of change the same way; only a change in which rooms are joined matters here.
    const joinedIds = () => [...session.rooms.keys()].sort().join("\n");
    let lastIds = joinedIds();
    const onChange = () => {
      const ids = joinedIds();
      if (ids === lastIds) return;
      lastIds = ids;
      schedule();
    };
    const unsubscribe = session.rooms.subscribe({
      onAdd: onChange,
      onRemove: onChange,
      onUpdate: () => {},
      onReset: onChange,
    });
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [session, platform, client, entered]);
}
