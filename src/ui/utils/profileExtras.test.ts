import { parseProfileExtras } from "./profileExtras";
import { typingUserIds } from "./typing";

describe("name tag profile extras", () => {
  it("reads pronouns from the stable or unstable key", () => {
    expect(parseProfileExtras({ "m.pronouns": [{ language: "en", summary: "she/her" }] }).pronouns).toBe("she/her");
    expect(parseProfileExtras({ "io.fsky.nyx.pronouns": [{ summary: "they/them" }] }).pronouns).toBe("they/them");
    expect(parseProfileExtras({ "m.pronouns": [{ summary: 5 }] }).pronouns).toBeUndefined();
  });

  it("only accepts mxc banners", () => {
    expect(parseProfileExtras({ "software.haven.banner": "mxc://hs.example/abc" }).bannerUrl).toBe(
      "mxc://hs.example/abc"
    );
    expect(parseProfileExtras({ "software.haven.banner": "https://evil.example/x.png" }).bannerUrl).toBeUndefined();
  });
});

describe("typing notifications", () => {
  it("reads the latest m.typing for the room", () => {
    const detail = {
      roomId: "!r",
      events: [
        { type: "m.typing", content: { user_ids: ["@a:x"] } },
        { type: "m.receipt", content: {} },
        { type: "m.typing", content: { user_ids: ["@b:x", 3, "nope"] } },
      ],
    };
    expect(typingUserIds(detail, "!r")).toEqual(["@b:x"]);
    expect(typingUserIds(detail, "!other")).toBeUndefined();
  });
});

describe("banners from other clients", () => {
  it("uses a Commet banner when there's no Buzzar one, and prefers Buzzar's", () => {
    const commet = "mxc://glowers.club/MntSjgtaVczPTWAZoqgyqbFp";
    expect(parseProfileExtras({ "chat.commet.profile_banner": commet })).toEqual({ bannerUrl: commet, bannerFrom: "Commet" });
    expect(parseProfileExtras({ "chat.commet.profile_banner": commet, "software.haven.banner": "mxc://a.b/own" })).toEqual({
      bannerUrl: "mxc://a.b/own",
    });
    expect(parseProfileExtras({ "chat.commet.profile_banner": "https://not-mxc" })).toEqual({});
  });
});
