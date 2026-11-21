/**
 * Buzzar: a URL for a message's media. Plain media loads from the homeserver; media from encrypted rooms is
 * downloaded and decrypted here (AES-CTR, as the Matrix spec's `EncryptedFile`), then shown from a blob URL.
 */
import { useEffect, useState } from "react";

import { useMatrix } from "./useMatrix";

export interface EncryptedFile {
  url: string;
  key: JsonWebKey;
  iv: string;
  hashes?: Record<string, string>;
}

function decodeBase64(value: string) {
  const text = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

async function decrypt(file: EncryptedFile, data: ArrayBuffer, mimetype?: string): Promise<Blob> {
  const key = await crypto.subtle.importKey("jwk", file.key, { name: "AES-CTR" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-CTR", counter: decodeBase64(file.iv), length: 64 }, key, data);
  return new Blob([plain], mimetype ? { type: mimetype } : undefined);
}

/** The URL to show for `content.url` (plain) or `content.file` (encrypted); undefined while loading. */
export function useMediaUrl(
  content: { url?: string; file?: EncryptedFile; info?: { mimetype?: string } } | undefined,
  thumbnail?: { width: number; height: number }
): string | undefined {
  const { session } = useMatrix(true);
  const [decrypted, setDecrypted] = useState<string>();
  const file = content?.file;
  const mimetype = content?.info?.mimetype;

  useEffect(() => {
    setDecrypted(undefined);
    if (!file?.url) return;
    const http = session.mediaRepository.mxcUrl(file.url);
    if (!http) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    fetch(http)
      .then((res) => {
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        return res.arrayBuffer();
      })
      .then((data) => decrypt(file, data, mimetype))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setDecrypted(objectUrl);
      })
      .catch((e) => console.warn("Couldn't load an encrypted attachment", e));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, mimetype, session]);

  if (file) return decrypted;
  if (!content?.url) return undefined;
  if (thumbnail) {
    const thumb = session.mediaRepository.mxcUrlThumbnail(content.url, thumbnail.width, thumbnail.height, "scale");
    if (thumb) return thumb;
  }
  return session.mediaRepository.mxcUrl(content.url);
}
