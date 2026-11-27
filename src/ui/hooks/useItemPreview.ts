/**
 * Buzzar: a custom Item's picture: its preview image when it has one, otherwise one rendered from its .glb.
 */
import { useEffect, useState } from "react";

import { useMatrix } from "./useMatrix";
import { renderAvatarPreviewFromUrl } from "../utils/avatarPreview";

export function useItemPreview(url: string | undefined, previewUrl: string | undefined) {
  const { session } = useMatrix(true);
  const [rendered, setRendered] = useState<string>();
  const [loading, setLoading] = useState(false);
  const preview = previewUrl
    ? session.mediaRepository.mxcUrlThumbnail(previewUrl, 360, 480, "scale") ?? undefined
    : undefined;

  useEffect(() => {
    setRendered(undefined);
    if (previewUrl || !url?.startsWith("mxc://")) return;
    const httpUrl = session.mediaRepository.mxcUrl(url);
    if (!httpUrl) return;
    let objectUrl: string | undefined;
    let cancelled = false;
    setLoading(true);
    renderAvatarPreviewFromUrl(url, httpUrl, "item")
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setRendered(objectUrl);
      })
      .catch((e) => console.warn("Couldn't render an Item preview", e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, previewUrl, session]);

  return { src: preview ?? rendered, rendered, loading: loading && !preview };
}
