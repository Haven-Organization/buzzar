import { ImageTile, Builder, BaseMessageTile } from "@thirdroom/hydrogen-view-sdk";

import { ChatBaseMessage } from "./ChatBaseMessage";
import { mediaRepositoryOf, renderReplyQuote } from "./messageParts";

import "./ChatImage.css";

/** Image formats that may be animated: show the original file, since server thumbnails are still frames. */
const ANIMATED = new Set(["image/gif", "image/webp", "image/apng"]);

/** Buzzar: the source to show for an image or sticker: the original for (possibly) animated images. */
export function imageSource(vm: ImageTile): string {
  const content = vm._getContent() as { url?: string; file?: unknown; info?: { mimetype?: string } } | undefined;
  const mimetype = content?.info?.mimetype ?? vm.mimeType;
  // Unencrypted only: encrypted files have to be downloaded and decrypted by the tile (thumbnailUrl).
  if (content?.url && !content.file && mimetype && ANIMATED.has(mimetype)) {
    const full = mediaRepositoryOf(vm).mxcUrl(content.url);
    if (full) return full;
  }
  return vm.thumbnailUrl;
}

/**
 * Tells an image tile it's on screen, which makes it produce its URL (and download/decrypt encrypted images).
 * Deferred until after the view is mounted: notifying during render makes the timeline restore its scroll
 * position before its DOM exists ("Cannot read properties of undefined (reading 'firstElementChild')").
 */
export function notifyVisibleAfterMount(vm: ImageTile) {
  window.setTimeout(() => {
    if (!vm.isDisposed) vm.notifyVisible();
  }, 0);
}

export class ChatImage extends ChatBaseMessage {
  constructor(vm: ImageTile) {
    super(vm);
  }

  renderBody<T extends Builder<BaseMessageTile>>(t: T, vm: ImageTile): Element {
    const { height, width } = vm;
    const content = vm._getContent() as { body?: string; url?: string } | undefined;
    const unencrypted = content?.url && !(content as { file?: unknown }).file;
    const full = unencrypted ? mediaRepositoryOf(vm).mxcUrl(content!.url!) : undefined;
    // The tile only produces a URL once it's told it's visible (that's also what starts downloading and
    // decrypting encrypted images), and the URL changes when that finishes, so bind src instead of setting it once.
    notifyVisibleAfterMount(vm);
    const img = t.img({
      src: (tile: BaseMessageTile) => imageSource(tile as ImageTile),
      alt: content?.body ?? "image",
      title: content?.body ?? "",
      loading: "lazy",
      style: `max-width: 340px; width: ${width || 340}px; height: ${height}px; object-fit: contain;`,
    });
    return t.div({ className: "ChatImage__body flex flex-column" }, [
      renderReplyQuote(t, vm, "ChatMessage__reply Text Text-b3 Text--surface-low Text--regular"),
      full ? t.a({ href: full, target: "_blank", rel: "noopener noreferrer" }, img) : img,
    ]);
  }
  onClick() {}
}
