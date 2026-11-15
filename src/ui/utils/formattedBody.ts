/**
 * Buzzar: renders Matrix message content (the `formatted_body` HTML when there is one, otherwise the plain
 * `body`) as safe DOM nodes.
 *
 * The HTML comes from other users, so it is never inserted as HTML. It's parsed into an inert document (scripts
 * don't run, images don't load) and rebuilt element by element from the allow-list in the Matrix spec
 * (client-server API, "m.room.message msgtypes" → HTML subset). Anything else is dropped, keeping its text.
 * Images may only point at mxc:// media, which is resolved through the user's own homeserver.
 */
import { linkifyText } from "./common";

export type MxcResolver = (mxc: string) => string | undefined | null;

const ALLOWED_TAGS = new Set([
  "font", "del", "s", "strike", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "p", "a", "ul", "ol", "sup",
  "sub", "li", "b", "i", "u", "strong", "em", "code", "hr", "br", "div", "table", "thead", "tbody", "tr", "th",
  "td", "caption", "pre", "span", "img", "details", "summary",
]); // prettier-ignore

/** Elements dropped with everything inside them. */
const DROPPED_TAGS = new Set([
  "mx-reply",
  "script",
  "style",
  "head",
  "title",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
]);

const SAFE_LINK = /^(https?:|ftp:|mailto:|magnet:)/i;
const COLOR = /^#[0-9a-f]{6}$/i;
const MAX_DEPTH = 64;
const MAX_INLINE_IMAGE = 256;

export interface RenderOptions {
  resolveMxc: MxcResolver;
  /** Strip the plain-text reply fallback (`> <@user> quoted` lines) from replies. */
  isReply?: boolean;
}

/** Removes the reply fallback that clients prepend to the plain body of replies. */
export function stripPlainReplyFallback(body: string): string {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].startsWith("> ")) i++;
  if (i === 0) return body;
  if (lines[i] === "") i++;
  return lines.slice(i).join("\n");
}

function copyColor(from: Element, to: HTMLElement) {
  const color = from.getAttribute("data-mx-color") ?? (from.tagName === "FONT" ? from.getAttribute("color") : null);
  const bg = from.getAttribute("data-mx-bg-color");
  if (color && COLOR.test(color)) to.style.color = color;
  if (bg && COLOR.test(bg)) to.style.backgroundColor = bg;
}

function sanitizeNode(node: Node, out: Node, options: RenderOptions, depth: number) {
  if (depth > MAX_DEPTH) return;
  if (node.nodeType === Node.TEXT_NODE) {
    out.appendChild(document.createTextNode(node.textContent ?? ""));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const source = node as Element;
  const tag = source.tagName.toLowerCase();
  if (DROPPED_TAGS.has(tag)) return;

  if (!ALLOWED_TAGS.has(tag)) {
    // Unknown element: keep its (sanitized) contents.
    source.childNodes.forEach((child) => sanitizeNode(child, out, options, depth + 1));
    return;
  }

  let element: HTMLElement;
  switch (tag) {
    case "a": {
      const href = source.getAttribute("href") ?? "";
      if (!SAFE_LINK.test(href)) {
        source.childNodes.forEach((child) => sanitizeNode(child, out, options, depth + 1));
        return;
      }
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
      element = a;
      break;
    }
    case "img": {
      const src = source.getAttribute("src") ?? "";
      const url = src.startsWith("mxc://") ? options.resolveMxc(src) : undefined;
      const alt = source.getAttribute("alt") ?? source.getAttribute("title") ?? "";
      if (!url) {
        if (alt) out.appendChild(document.createTextNode(alt));
        return;
      }
      const img = document.createElement("img");
      img.src = url;
      img.alt = alt;
      img.title = source.getAttribute("title") ?? alt;
      img.loading = "lazy";
      img.className = "FormattedBody__img";
      // Custom emoji are small and set height; keep any size within bounds.
      const height = Number(source.getAttribute("height"));
      const width = Number(source.getAttribute("width"));
      if (height > 0) img.style.height = `${Math.min(height, MAX_INLINE_IMAGE)}px`;
      if (width > 0) img.style.maxWidth = `${Math.min(width, MAX_INLINE_IMAGE)}px`;
      if (source.hasAttribute("data-mx-emoticon")) img.classList.add("FormattedBody__emoji");
      out.appendChild(img);
      return;
    }
    case "font":
      element = document.createElement("span");
      copyColor(source, element);
      break;
    case "span": {
      element = document.createElement("span");
      copyColor(source, element);
      if (source.hasAttribute("data-mx-spoiler")) {
        element.className = "FormattedBody__spoiler";
        element.title = source.getAttribute("data-mx-spoiler") || "Spoiler";
        element.tabIndex = 0;
        const reveal = (e: Event) => {
          (e.currentTarget as HTMLElement).classList.add("FormattedBody__spoiler--shown");
        };
        element.addEventListener("click", reveal);
        element.addEventListener("keydown", reveal);
      }
      break;
    }
    case "ol": {
      element = document.createElement("ol");
      const start = Number(source.getAttribute("start"));
      if (Number.isInteger(start)) (element as HTMLOListElement).start = start;
      break;
    }
    case "code": {
      element = document.createElement("code");
      const cls = source.getAttribute("class");
      if (cls && /^language-[\w-]+$/.test(cls)) element.className = cls;
      break;
    }
    default:
      element = document.createElement(tag);
  }
  source.childNodes.forEach((child) => sanitizeNode(child, element, options, depth + 1));
  out.appendChild(element);
}

/** Sanitized DOM for an HTML `formatted_body`. */
export function sanitizeMatrixHtml(html: string, options: RenderOptions): DocumentFragment {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const fragment = document.createDocumentFragment();
  doc.body.childNodes.forEach((child) => sanitizeNode(child, fragment, options, 0));
  return fragment;
}

/** Plain text with links, keeping line breaks. */
function plainToNodes(body: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  body.split("\n").forEach((line, i) => {
    if (i > 0) fragment.appendChild(document.createElement("br"));
    for (const part of linkifyText(line)) fragment.appendChild(part);
  });
  return fragment;
}

/** The message body as DOM: formatted when the event has HTML, otherwise the plain body. */
export function renderMessageBody(content: Record<string, unknown> | undefined, options: RenderOptions): Node {
  const wrapper = document.createElement("span");
  wrapper.className = "FormattedBody";
  if (!content) return wrapper;
  // Edits (m.replace) carry the new text in m.new_content.
  const source = (content["m.new_content"] as Record<string, unknown> | undefined) ?? content;
  const html = source.format === "org.matrix.custom.html" ? source.formatted_body : undefined;
  if (typeof html === "string" && html.trim()) {
    wrapper.appendChild(sanitizeMatrixHtml(html, options));
  } else {
    const body = typeof source.body === "string" ? source.body : "";
    wrapper.appendChild(plainToNodes(options.isReply ? stripPlainReplyFallback(body) : body));
  }
  return wrapper;
}

/** One-line plain-text preview of a message (for reply quotes and speech bubbles). */
export function messagePreviewText(content: Record<string, unknown> | undefined, maxLength = 140): string {
  if (!content) return "";
  const msgtype = content.msgtype;
  if (msgtype === "m.image") return "sent an image";
  if (msgtype === "m.video") return "sent a video";
  if (msgtype === "m.audio") return "sent audio";
  if (msgtype === "m.file") return "sent a file";
  let text = typeof content.body === "string" ? content.body : "";
  if ((content["m.relates_to"] as Record<string, unknown> | undefined)?.["m.in_reply_to"]) {
    text = stripPlainReplyFallback(text);
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
