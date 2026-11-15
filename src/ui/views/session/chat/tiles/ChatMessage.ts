import { TextTile, Builder, BaseMessageTile } from "@thirdroom/hydrogen-view-sdk";

import { ChatBaseMessage } from "./ChatBaseMessage";
import { renderFormattedBody, renderReplyQuote } from "./messageParts";

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
    ]);
  }
  onClick() {}
}
