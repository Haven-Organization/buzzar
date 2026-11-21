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
