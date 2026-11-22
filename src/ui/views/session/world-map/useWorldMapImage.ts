/** Buzzar (Third Room #461): the picture behind the world map, and an object URL for it (see plugins/world-map). */
import { useCallback, useEffect, useState } from "react";

import { Room, StateEvent } from "../../../../matrix";
import { useMatrix } from "../../../hooks/useMatrix";
import { useStateEventKeyCallback } from "../../../hooks/useStateEventKeyCallback";
import { parseMapEvent, WORLD_MAP_EVENT, WorldMapImage } from "../../../../plugins/world-map/worldMap.common";

/** The map a creator generated for the world (the state event), if any. */
export function useGeneratedWorldMap(room: Room) {
  const [map, setMap] = useState<ReturnType<typeof parseMapEvent>>();
  const onEvent = useCallback((event: StateEvent | undefined) => setMap(parseMapEvent(event?.content)), []);
  useStateEventKeyCallback(room, WORLD_MAP_EVENT, "", onEvent);
  return map;
}

/** A URL an <img> can show for a map picture (mxc, http or Blob). */
export function useMapImageSrc(image?: WorldMapImage): string | undefined {
  const { session } = useMatrix(true);
  const [blobUrl, setBlobUrl] = useState<string>();
  useEffect(() => {
    if (!image?.blob) return setBlobUrl(undefined);
    const url = URL.createObjectURL(image.blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image?.blob]);
  if (image?.blob) return blobUrl;
  if (!image?.url) return undefined;
  return image.url.startsWith("mxc://") ? session.mediaRepository.mxcUrl(image.url) ?? undefined : image.url;
}
