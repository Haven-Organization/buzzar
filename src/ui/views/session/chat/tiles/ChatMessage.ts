import { TextTile, Builder, BaseMessageTile } from "@thirdroom/hydrogen-view-sdk";

import { ChatBaseMessage } from "./ChatBaseMessage";
import { renderFormattedBody, renderReplyQuote } from "./messageParts";
import { extractRoomLinks } from "../../../../utils/chatEmbeds";

import "./ChatMessage.css";

export class ChatMessage extends ChatBaseMessage {
  constructor(vm: TextTile) {
    super(vm);
  }

  renderBody<T extends Builder<BaseMessageTile>>(t: T, vm: TextTile): Element {
    const isEmote = vm._getContent()?.msgtype === "m.emote";
    return t.div({ className: "ChatMessage__body flex flex-column" }, [
      renderReplyQuote(t, vm, "ChatMessage__reply Text Text-b3 Text--surface-low Text--regular"),
      t.div({ className: "Text Text-b2 Text--surface Text--regular" }, [
        isEmote ? `* ${vm.displayName} ` : "",
        renderFormattedBody(t, vm, "ChatMessage__text"),
      ]),
      // Buzzar: rooms it links to; ChatTimeline turns the ones that are worlds into tiles (ChatWorldEmbed).
      t.map(
        (vm: BaseMessageTile) => vm._getContent(),
        (content: Record<string, unknown> | undefined, t: Builder<BaseMessageTile>) =>
          t.div(
            { className: "ChatMessage__embeds" },
            extractRoomLinks(content).map((link) =>
              t.div({ className: "ChatEmbed", "data-world-link": link.target, "data-world-via": link.via.join(",") })
            )
          )
      ),
    ]);
  }
  onClick() {}
}
