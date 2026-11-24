import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { Room, Session } from "../../matrix";
import { roomIdToAlias } from "../utils/matrixUtils";
import { useWorldLoader } from "./useWorldLoader";

let worldReloadId = 0;

export function useWorldNavigator(session: Session) {
  const navigate = useNavigate();
  const { exitWorld } = useWorldLoader();

  const navigateEnterWorld = useCallback(
    (
      world: Room,
      options?: {
        reload?: boolean;
        /** Buzzar: the instance to join (src/matrix/instances.ts): an instance ID, or "new". */
        instance?: string;
      }
    ) => {
      const { reload, instance } = options ?? {};

      const worldAlias = roomIdToAlias(session.rooms, world.id);
      const params = new URLSearchParams();
      if (reload) params.set("reload", String(++worldReloadId));
      if (instance) params.set("instance", instance);
      const query = params.toString();

      navigate(`/world/${worldAlias ?? world.id}${query ? `?${query}` : ""}`);
    },
    [session.rooms, navigate]
  );

  const navigateExitWorld = useCallback(() => {
    exitWorld();
    navigate("/");
  }, [navigate, exitWorld]);

  return {
    navigateEnterWorld,
    navigateExitWorld,
  };
}
