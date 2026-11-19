import { describe, expect, it } from "vitest";

import { mediaCaption } from "./messageParts";

describe("mediaCaption", () => {
  it("is the body when it differs from the filename", () => {
    const content = { msgtype: "m.image", body: "Look at this!", filename: "cat.png" };
    expect(mediaCaption(content)).toBe(content);
  });
  it("is nothing when the body is just the filename", () => {
    expect(mediaCaption({ msgtype: "m.image", body: "cat.png", filename: "cat.png" })).toBeUndefined();
  });
  it("treats a bare file name without filename as no caption", () => {
    expect(mediaCaption({ msgtype: "m.image", body: "IMG_2041.jpeg" })).toBeUndefined();
    expect(mediaCaption({ msgtype: "m.image", body: "image" })).toBeUndefined();
  });
  it("shows a sentence body without filename (bridges)", () => {
    const content = { msgtype: "m.image", body: "👍 cool_boy_mew liked your post" };
    expect(mediaCaption(content)).toBe(content);
  });
  it("shows a formatted body", () => {
    const content = {
      msgtype: "m.image",
      body: "x.png",
      format: "org.matrix.custom.html",
      formatted_body: "<b>hi</b>",
    };
    expect(mediaCaption(content)).toBe(content);
  });
});
