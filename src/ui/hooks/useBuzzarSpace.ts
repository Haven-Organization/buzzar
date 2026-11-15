import { useEffect } from "react";

import { getSessionAuth } from "../utils/avatarMatrix";
import { syncBuzzarSpace, WORLD_ROOM_TYPE } from "../utils/buzzarSpace";
import { useHydrogen } from "./useHydrogen";

/** Re-sync at most this often while rooms change (joining a world adds a room; leaving removes one). */
const SYNC_DELAY_MS = 5_000;

/**
 * Buzzar: keeps the user's personal "Buzzar" space listing the worlds they're in (see utils/buzzarSpace.ts).
 * Runs once after sign-in, then whenever the room list changes. Does nothing if the user turned it off.
 */
export function useBuzzarSpace() {
  const { session, platform, client } = useHydrogen(true);

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
        const result = await syncBuzzarSpace(auth, session.userId, worldIds);
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
    const unsubscribe = session.rooms.subscribe({
      onAdd: schedule,
      onRemove: schedule,
      onUpdate: () => {},
      onReset: schedule,
    });
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [session, platform, client]);
}
