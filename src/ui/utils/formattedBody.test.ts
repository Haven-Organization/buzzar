/**
 * @vitest-environment jsdom
 */
import { messagePreviewText, renderMessageBody, sanitizeMatrixHtml, stripPlainReplyFallback } from "./formattedBody";

const resolveMxc = (mxc: string) => `https://hs.example/_matrix/media/r0/download/${mxc.slice(6)}`;
const html = (s: string) => {
  const div = document.createElement("div");
  div.appendChild(sanitizeMatrixHtml(s, { resolveMxc }));
  return div.innerHTML;
};

describe("formatted message bodies", () => {
  it("keeps allowed formatting", () => {
    expect(html("<b>bold</b> <em>em</em> <code>x</code>")).toBe("<b>bold</b> <em>em</em> <code>x</code>");
    expect(html('<ol start="3"><li>a</li></ol>')).toBe('<ol start="3"><li>a</li></ol>');
  });

  it("drops scripts, event handlers, styles and unsafe links", () => {
    expect(html('<img src="x" onerror="alert(1)"><script>alert(1)</script>hi')).toBe("hi");
    expect(html('<b onclick="alert(1)" style="color:red">x</b>')).toBe("<b>x</b>");
    expect(html('<a href="javascript:alert(1)">click</a>')).toBe("click");
    expect(html("<iframe src=x></iframe><svg><circle/></svg>ok")).toBe("ok");
    expect(html("<marquee>text kept</marquee>")).toBe("text kept");
  });

  it("makes safe links open in a new tab", () => {
    expect(html('<a href="https://example.org">x</a>')).toBe(
      '<a href="https://example.org" target="_blank" rel="noopener noreferrer nofollow">x</a>'
    );
  });

  it("resolves mxc images and refuses http ones", () => {
    expect(html('<img src="mxc://hs.example/abc" alt="cat">')).toContain(
      'src="https://hs.example/_matrix/media/r0/download/hs.example/abc"'
    );
    expect(html('<img src="https://tracker.example/pixel.gif" alt="pixel">')).toBe("pixel");
  });

  it("only allows hex colours", () => {
    expect(html('<font color="#ff0000">r</font>')).toBe('<span style="color: rgb(255, 0, 0);">r</span>');
    expect(html('<span data-mx-color="red;background:url(x)">r</span>')).toBe("<span>r</span>");
  });

  it("drops the HTML reply fallback", () => {
    expect(html("<mx-reply><blockquote>old</blockquote></mx-reply>new")).toBe("new");
  });

  it("strips the plain reply fallback", () => {
    expect(stripPlainReplyFallback("> <@a:x> old\n> more\n\nnew")).toBe("new");
    expect(stripPlainReplyFallback("no quote")).toBe("no quote");
  });

  it("uses the plain body when there's no HTML, keeping line breaks", () => {
    const node = renderMessageBody({ body: "a\nb" }, { resolveMxc }) as HTMLElement;
    expect(node.innerHTML).toBe("a<br>b");
  });

  it("shows the edited text of an edit", () => {
    const node = renderMessageBody(
      { body: "* x", "m.new_content": { body: "x", format: "org.matrix.custom.html", formatted_body: "<i>x</i>" } },
      { resolveMxc }
    ) as HTMLElement;
    expect(node.innerHTML).toBe("<i>x</i>");
  });

  it("previews messages in one line", () => {
    expect(messagePreviewText({ msgtype: "m.image", body: "a.png" })).toBe("sent an image");
    expect(messagePreviewText({ body: "a\n\nb" })).toBe("a b");
  });
});
