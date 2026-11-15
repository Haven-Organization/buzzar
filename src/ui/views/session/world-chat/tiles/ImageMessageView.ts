import { TemplateView, ImageTile, Builder, TileView } from "@thirdroom/hydrogen-view-sdk";

import { imageSource } from "../../chat/tiles/ChatImage";
import "./TextMessageView.css";

/** Buzzar: images, GIFs and stickers in the in-world chat. */
export class ImageMessageView extends TemplateView<ImageTile> implements TileView {
  constructor(vm: ImageTile) {
    super(vm);
  }

  render(t: Builder<ImageTile>, vm: ImageTile): Element {
    const content = vm._getContent() as { body?: string } | undefined;
    vm.notifyVisible(); // starts loading (and decrypting) the image; src is bound below
    return t.li({ className: "WorldChat__TextMessageView" }, [
      t.div({ className: "Text Text-b2 Text--world Text--regular" }, [
        t.span(
          { className: "WorldChat__TextMessageView-sender Text Text-b2 Text--world Text--semi-bold" },
          `${vm.displayName}:`
        ),
      ]),
      t.img({
        className: "WorldChat__ImageMessageView-img",
        src: (vm: ImageTile) => imageSource(vm),
        alt: content?.body ?? "image",
        loading: "lazy",
      }),
    ]);
  }
  onClick() {}
}
