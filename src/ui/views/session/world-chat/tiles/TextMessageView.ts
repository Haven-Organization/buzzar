import { TemplateView, TextTile, Builder, TileView } from "@thirdroom/hydrogen-view-sdk";
import classNames from "classnames";

import { renderFormattedBody } from "../../chat/tiles/messageParts";
import "./TextMessageView.css";

export class TextMessageView extends TemplateView<TextTile> implements TileView {
  constructor(vm: TextTile) {
    super(vm);
  }

  render(t: Builder<TextTile>, vm: TextTile): Element {
    const isEmote = vm._getContent()?.msgtype === "m.emote";

    return t.li(
      { className: classNames("WorldChat__TextMessageView", { "WorldChat__TextMessageView--emote": isEmote }) },
      t.div({ className: "Text Text-b2 Text--world Text--regular" }, [
        isEmote
          ? ""
          : t.span(
              { className: "WorldChat__TextMessageView-sender Text Text-b2 Text--world Text--semi-bold" },
              `${vm.displayName}:`
            ),
        isEmote ? `* ${vm.displayName} ` : "",
        renderFormattedBody(t, vm, "WorldChat__TextMessageView-body"),
      ])
    );
  }
  onClick() {}
}
