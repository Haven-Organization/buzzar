import { Builder, BaseMessageTile } from "@thirdroom/hydrogen-view-sdk";

import { ChatBaseMessage } from "./ChatBaseMessage";
import { mediaRepositoryOf, renderReplyQuote } from "./messageParts";
import { isModelFile } from "../../../../utils/chatEmbeds";
import "./ChatMedia.css";

type MediaContent = {
  body?: string;
  filename?: string;
  url?: string;
  file?: unknown;
  msgtype?: string;
  info?: { size?: number; mimetype?: string; thumbnail_url?: string; w?: number; h?: number };
};

function formatSize(bytes?: number) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Buzzar: videos play inline; audio and other files show as a download link. */
export class ChatMedia extends ChatBaseMessage {
  renderBody<T extends Builder<BaseMessageTile>>(t: T, vm: BaseMessageTile): Element {
    const content = (vm._getContent() ?? {}) as MediaContent;
    const media = mediaRepositoryOf(vm);
    const url = content.url ? media.mxcUrl(content.url) : undefined;
    const name = content.filename ?? content.body ?? "file";
    let body: Element;
    if (!url) {
      body = t.p({ className: "Text Text-b2 Text--surface-low" }, content.file ? "Encrypted attachment" : name);
    } else if (content.msgtype === "m.video") {
      const poster = content.info?.thumbnail_url ? media.mxcUrl(content.info.thumbnail_url) : undefined;
      body = t.video({
        className: "ChatMedia__video",
        src: url,
        controls: true,
        preload: "metadata",
        ...(poster ? { poster } : {}),
      });
    } else if (content.url && !content.file && isModelFile(name, content.info?.mimetype)) {
      // Buzzar: a 3D model (avatar, world or Thing): ChatTimeline renders its tile here (ChatModelEmbed).
      body = t.div(
        {
          className: "ChatEmbed",
          "data-model-mxc": content.url,
          "data-model-name": name,
          "data-model-size": String(content.info?.size ?? ""),
        },
        [
          t.a(
            { className: "ChatMedia__file Text Text-b2 Text--surface", href: url, download: name },
            `📎 ${name}${content.info?.size ? ` (${formatSize(content.info.size)})` : ""}`
          ),
        ]
      );
    } else if (content.msgtype === "m.audio") {
      body = t.audio({ className: "ChatMedia__audio", src: url, controls: true, preload: "none" });
    } else {
      body = t.a(
        {
          className: "ChatMedia__file Text Text-b2 Text--surface",
          href: url,
          target: "_blank",
          rel: "noopener noreferrer",
          download: name,
        },
        `📎 ${name}${content.info?.size ? ` (${formatSize(content.info.size)})` : ""}`
      );
    }
    return t.div({ className: "ChatMedia__body flex flex-column" }, [
      renderReplyQuote(t, vm, "ChatMessage__reply Text Text-b3 Text--surface-low Text--regular"),
      body,
    ]);
  }
  onClick() {}
}
