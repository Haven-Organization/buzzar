import { describe, expect, it } from "vitest";

import { findBan, globMatches, parsePolicyRules, parseWorldModeration } from "./policyLists";

describe("world ban lists", () => {
  it("reads the world's followed lists (untrusted)", () => {
    expect(parseWorldModeration(undefined).policyRooms).toEqual([]);
    expect(
      parseWorldModeration({
        policy_rooms: ["!a:x.org", "#bans:x.org", "!a:x.org", "nonsense", 5, "@user:x.org", "#no-server"],
      }).policyRooms
    ).toEqual(["!a:x.org", "#bans:x.org"]);
  });

  it("keeps only ban rules, in every rule type's spelling", () => {
    const rules = parsePolicyRules([
      { type: "m.policy.rule.user", content: { entity: "@spam:x.org", recommendation: "m.ban", reason: "spam" } },
      {
        type: "org.matrix.mjolnir.rule.server",
        content: { entity: "*.evil", recommendation: "org.matrix.mjolnir.ban" },
      },
      { type: "m.room.rule.user", content: { entity: "@old:x.org", recommendation: "m.ban" } },
      // Removed rule (empty content), another recommendation, room rules, other events: skipped.
      { type: "m.policy.rule.user", content: {} },
      { type: "m.policy.rule.user", content: { entity: "@x:x.org", recommendation: "m.mute" } },
      { type: "m.policy.rule.room", content: { entity: "!r:x.org", recommendation: "m.ban" } },
      { type: "m.room.name", content: { name: "Bans" } },
    ]);
    expect(rules).toEqual([
      { kind: "user", entity: "@spam:x.org", reason: "spam" },
      { kind: "server", entity: "*.evil", reason: undefined },
      { kind: "user", entity: "@old:x.org", reason: undefined },
    ]);
  });

  it("matches globs literally apart from * and ?", () => {
    expect(globMatches("@*:spam.example", "@anyone:spam.example")).toBe(true);
    expect(globMatches("@*:spam.example", "@anyone:spam.examples")).toBe(false);
    expect(globMatches("@bot?:x.org", "@bot1:x.org")).toBe(true);
    expect(globMatches("@bot?:x.org", "@bot12:x.org")).toBe(false);
    expect(globMatches("@a.b:x.org", "@aXb:x.org")).toBe(false);
    expect(globMatches("@a.b:x.org", "@a.b:x.org")).toBe(true);
  });

  it("bans users by user rules and by their server", () => {
    const rules = parsePolicyRules([
      { type: "m.policy.rule.user", content: { entity: "@troll:x.org", recommendation: "m.ban" } },
      { type: "m.policy.rule.server", content: { entity: "*.evil", recommendation: "m.ban" } },
    ]);
    expect(findBan(rules, "@troll:x.org")?.entity).toBe("@troll:x.org");
    expect(findBan(rules, "@someone:matrix.evil")?.kind).toBe("server");
    expect(findBan(rules, "@someone:x.org")).toBeUndefined();
    // A server rule is about the server name, not the whole user ID.
    expect(findBan(rules, "@x.evil:x.org")).toBeUndefined();
  });
});

describe("ban entries typed in World Settings", () => {
  it("tells accounts from servers", async () => {
    const { parseBanEntity } = await import("../ui/views/session/world-settings/WorldModerationSettings");
    expect(parseBanEntity(" @troll:x.org ")).toEqual({ kind: "user", entity: "@troll:x.org" });
    expect(parseBanEntity("@*:spam.example")).toEqual({ kind: "user", entity: "@*:spam.example" });
    expect(parseBanEntity("*.evil")).toEqual({ kind: "server", entity: "*.evil" });
    expect(parseBanEntity("x.org:8448")).toEqual({ kind: "server", entity: "x.org:8448" });
    expect(parseBanEntity("@nocolon")).toBeUndefined();
    expect(parseBanEntity("two words")).toBeUndefined();
    expect(parseBanEntity("https://x.org")).toBeUndefined();
  });
});
