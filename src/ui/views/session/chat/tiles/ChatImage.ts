import { ImageTile, Builder, BaseMessageTile } from "@thirdroom/hydrogen-view-sdk";

import { ChatBaseMessage } from "./ChatBaseMessage";
import { mediaRepositoryOf, renderReplyQuote } from "./messageParts";

import "./ChatImage.css";

/** Image formats that may be animated: show the original file, since server thumbnails are still frames. */
const ANIMATED = new Set(["image/gif", "image/webp", "image/apng"]);

/** Buzzar: the source to show for an image or sticker: the original for (possibly) animated images. */
export function imageSource(vm: ImageTile): string {
  const content = vm._getContent() as { url?: string; info?: { mimetype?: string } } | undefined;
  const mimetype = content?.info?.mimetype ?? vm.mimeType;
  if (content?.url && mimetype && ANIMATED.has(mimetype)) {
    const full = mediaRepositoryOf(vm).mxcUrl(content.url);
    if (full) return full;
  }
  return vm.thumbnailUrl;
}

export class ChatImage extends ChatBaseMessage {
  constructor(vm: ImageTile) {
    super(vm);
  }

  renderBody<T extends Builder<BaseMessageTile>>(t: T, vm: ImageTile): Element {
    const { height, width } = vm;
    const content = vm._getContent() as { body?: string; url?: string } | undefined;
    const full = content?.url ? mediaRepositoryOf(vm).mxcUrl(content.url) : undefined;
    const img = t.img({
      src: imageSource(vm),
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
