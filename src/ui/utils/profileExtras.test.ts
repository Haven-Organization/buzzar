import { parseProfileExtras } from "./profileExtras";
import { typingUserIds } from "./typing";

describe("name tag profile extras", () => {
  it("reads pronouns from the stable or unstable key", () => {
    expect(parseProfileExtras({ "m.pronouns": [{ language: "en", summary: "she/her" }] }).pronouns).toBe("she/her");
    expect(parseProfileExtras({ "io.fsky.nyx.pronouns": [{ summary: "they/them" }] }).pronouns).toBe("they/them");
    expect(parseProfileExtras({ "m.pronouns": [{ summary: 5 }] }).pronouns).toBeUndefined();
  });

  it("only accepts mxc banners", () => {
    expect(parseProfileExtras({ "chat.commet.profile_banner": "mxc://hs.example/abc" }).bannerUrl).toBe(
      "mxc://hs.example/abc"
    );
    expect(
      parseProfileExtras({ "chat.commet.profile_banner": "https://evil.example/x.png" }).bannerUrl
    ).toBeUndefined();
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

describe("banners (MSC4427)", () => {
  it("reads the unstable chat.commet.profile_banner, preferring the stable m.banner_url", () => {
    const unstable = "mxc://example.org/MntSjgtaVczPTWAZoqgyqbFp";
    expect(parseProfileExtras({ "chat.commet.profile_banner": unstable })).toEqual({ bannerUrl: unstable });
    expect(parseProfileExtras({ "chat.commet.profile_banner": unstable, "m.banner_url": "mxc://a.b/stable" })).toEqual({
      bannerUrl: "mxc://a.b/stable",
    });
    expect(parseProfileExtras({ "chat.commet.profile_banner": "https://not-mxc" })).toEqual({});
    // The old Buzzar-only field is no longer used.
    expect(parseProfileExtras({ "software.haven.banner": "mxc://a.b/old" })).toEqual({});
  });
});
