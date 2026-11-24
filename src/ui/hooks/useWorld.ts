import { useLocation, useMatch } from "react-router-dom";

import { aliasToRoomId } from "../utils/matrixUtils";
import { useMatrix } from "./useMatrix";

function useWorld(): [string | undefined, string | undefined, string | undefined, string | undefined] {
  const location = useLocation();

  const worldMatch = useMatch({ path: "world/:worldId/*" });
  const [alias, hashSearch] = location.hash.split("?");
  const params = new URLSearchParams(location.search || hashSearch);
  const reloadId = params.get("reload") ?? undefined;
  // Buzzar: the world instance asked for (src/matrix/instances.ts): an instance ID, or "new".
  const instance = params.get("instance") ?? undefined;

  const worldId = worldMatch?.params["worldId"] ?? undefined;
  return [worldId, alias.match(/^(#|!)\S+:\S+/) ? alias : undefined, reloadId, instance];
}

/** The world named in the address (`/world/<id>` or `#alias`), joined or not. */
export function useWorldInAddress(): [string | undefined, string | undefined] {
  const [worldId, alias] = useWorld();
  return [worldId, alias];
}

/** The joined world in the address, its reload counter and the instance asked for (`?instance=`). */
export function useWorldPath(): [string | undefined, string | undefined, string | undefined] {
  const { session } = useMatrix(true);
  const [worldId, alias, reloadId, instance] = useWorld();

  const roomId = alias ? aliasToRoomId(session.rooms, alias) : worldId;
  if (!roomId || !session.rooms.get(roomId)) return [undefined, undefined, undefined];
  return [roomId, reloadId, instance];
}

export function useUnknownWorldPath(): [string | undefined, string | undefined] {
  const { session } = useMatrix(true);
  const [worldId, alias] = useWorld();

  if (worldId && session.rooms.get(worldId) === undefined) {
    return [worldId, undefined];
  }
  if (alias && aliasToRoomId(session.rooms, alias) === undefined) {
    return [undefined, alias];
  }

  return [undefined, undefined];
}
