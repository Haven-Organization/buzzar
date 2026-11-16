import { BaseMessageTile, Builder } from "@thirdroom/hydrogen-view-sdk";

import { messagePreviewText, renderMessageBody } from "../../../../utils/formattedBody";
import "../../../components/formatted-body/FormattedBody.css";

type MediaRepository = { mxcUrl(url: string): string | undefined };

export function mediaRepositoryOf(vm: BaseMessageTile): MediaRepository {
  return (vm as unknown as { _mediaRepository: MediaRepository })._mediaRepository;
}

/** Buzzar: the message's body, formatted (HTML) when possible, as safe DOM. Re-renders on edits. */
export function renderFormattedBody(t: Builder<BaseMessageTile>, vm: BaseMessageTile, className: string) {
  const media = mediaRepositoryOf(vm);
  return t.map(
    (vm: BaseMessageTile) => vm._getContent(),
    (content: Record<string, unknown> | undefined, t: Builder<BaseMessageTile>) =>
      t.div({ className }, [
        renderMessageBody(content, { resolveMxc: (mxc) => media.mxcUrl(mxc), isReply: vm.isReply }) as Element,
      ])
  );
}

/**
 * Buzzar: an image/video/file message's caption, if it has one (MSC2530): with a `filename`, a `body` that differs
 * from it; without one, a body that isn't just a file name (bridges send "liked your post" and the like), or a
 * formatted body.
 */
export function mediaCaption(content: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined;
  const body = typeof content.body === "string" ? content.body.trim() : "";
  const filename = typeof content.filename === "string" ? content.filename.trim() : "";
  const formatted = content.format === "org.matrix.custom.html" && typeof content.formatted_body === "string";
  if (!body && !formatted) return undefined;
  if (filename) return body !== filename || formatted ? content : undefined;
  if (formatted) return content;
  return /^\S+\.[a-z0-9]{2,5}$/i.test(body) || body === "image" ? undefined : content;
}

/** Buzzar: the caption under an image, formatted like a text message. */
export function renderMediaCaption(t: Builder<BaseMessageTile>, vm: BaseMessageTile, className: string) {
  const media = mediaRepositoryOf(vm);
  return t.map(
    (vm: BaseMessageTile) => mediaCaption(vm._getContent()),
    (caption: Record<string, unknown> | undefined, t: Builder<BaseMessageTile>) =>
      caption
        ? t.div({ className }, [renderMessageBody(caption, { resolveMxc: (mxc) => media.mxcUrl(mxc) }) as Element])
        : t.span({ className: "hidden" })
  );
}

/** Buzzar: "↳ Name: quoted text" above a reply, like Element's reply quote. */
export function renderReplyQuote(t: Builder<BaseMessageTile>, vm: BaseMessageTile, className: string) {
  return t.map(
    (vm: BaseMessageTile) => vm.replyTile as BaseMessageTile | null,
    (reply: BaseMessageTile | null, t: Builder<BaseMessageTile>) => {
      if (!vm.isReply) return t.span({ className: "hidden" });
      if (!reply) return t.div({ className }, "Replying to a message");
      const preview = messagePreviewText(reply._getContent?.()) || "a message";
      return t.div({ className }, [t.strong(`${reply.displayName}`), ` ${preview}`]);
    }
  );
}
