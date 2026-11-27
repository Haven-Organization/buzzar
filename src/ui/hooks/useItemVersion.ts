/**
 * Buzzar: the version an Item's file gives (HAVEN_metadata), for My Items. Saved with the Item when it's uploaded;
 * for ones saved before that, read from the start of the file (its JSON comes first, so only that much is asked for)
 * and remembered for the session.
 */
import { useEffect, useState } from "react";

import { useMatrix } from "./useMatrix";
import { readAssetMetadata } from "../../engine/gltf/assetMetadata";
import { readGlbJson } from "../utils/glbMetadata";

/** Enough of a .glb for its JSON (Items' JSON is a few to a few hundred kB). */
const HEAD_BYTES = 256 * 1024;
const known = new Map<string, Promise<string | undefined>>();

async function fetchVersion(httpUrl: string) {
  const res = await fetch(httpUrl, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
  if (!res.ok) return undefined;
  // A server that ignores Range sends the whole file, which works too.
  const json = await readGlbJson(await res.blob());
  return json ? readAssetMetadata(json).version : undefined;
}

export function useItemVersion(url: string | undefined, saved: string | undefined) {
  const { session } = useMatrix(true);
  const [version, setVersion] = useState(saved);
  useEffect(() => {
    if (saved) return setVersion(saved);
    if (!url?.startsWith("mxc://")) return;
    const httpUrl = session.mediaRepository.mxcUrl(url);
    if (!httpUrl) return;
    let current = true;
    let pending = known.get(url);
    if (!pending) {
      pending = fetchVersion(httpUrl).catch(() => undefined);
      known.set(url, pending);
    }
    pending.then((v) => current && setVersion(v));
    return () => {
      current = false;
    };
  }, [url, saved, session]);
  return version;
}

/** How My Items shows a version: "v1.2", or as given when it already starts with a v. */
export const versionLabel = (version: string) => (/^v/i.test(version) ? version : `v${version}`);
