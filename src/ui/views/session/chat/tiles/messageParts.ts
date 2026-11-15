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
