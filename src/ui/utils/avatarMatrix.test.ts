import { afterEach, describe, expect, test, vi } from "vitest";

import {
  AVATAR_KEY,
  builtinIdForUrl,
  LEGACY_AVATAR_KEY,
  outdatedBuiltinForUrl,
  parseAvatarCollection,
  parseAvatarContent,
  resolveAvatar,
  setProfileAvatar,
  setWorldAvatar,
} from "./avatarMatrix";

const auth = { homeserver: "https://hs.example/", accessToken: "tok" };

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      const route = routes[`${method} ${url}`];
      return new Response(JSON.stringify(route?.body ?? {}), { status: route?.status ?? (route ? 200 : 404) });
    })
  );
  return calls;
}

describe("parseAvatarContent", () => {
  test("accepts valid content and drops unknown fields", () => {
    expect(
      parseAvatarContent({ url: "mxc://hs.example/abc_DEF-1", format: "vrm1", preview_url: "mxc://a/b", extra: 1 })
    ).toEqual({ url: "mxc://hs.example/abc_DEF-1", format: "vrm1", preview_url: "mxc://a/b" });
  });

  test("rejects non-mxc and malformed URLs", () => {
    expect(parseAvatarContent({ url: "https://evil.example/a.glb" })).toBeUndefined();
    expect(parseAvatarContent({ url: "mxc://a/../b" })).toBeUndefined();
    expect(parseAvatarContent("mxc://a/b")).toBeUndefined();
    expect(parseAvatarContent(null)).toBeUndefined();
  });

  test("ignores a bad preview or format but keeps the avatar", () => {
    expect(parseAvatarContent({ url: "mxc://a/b", preview_url: "javascript:x", format: "fbx" })).toEqual({
      url: "mxc://a/b",
    });
  });
});

const memberUrl = "https://hs.example/_matrix/client/v3/rooms/!w%3Ahs/state/m.room.member/%40u%3Ahs";
const profileUrl = `https://hs.example/_matrix/client/v3/profile/%40u%3Ahs/${encodeURIComponent(AVATAR_KEY)}`;
const legacyProfileUrl = `https://hs.example/_matrix/client/v3/profile/%40u%3Ahs/${encodeURIComponent(
  LEGACY_AVATAR_KEY
)}`;

describe("resolveAvatar", () => {
  test("prefers the per-world member event", async () => {
    mockFetch({
      [`GET ${memberUrl}`]: { body: { membership: "join", [AVATAR_KEY]: { url: "mxc://hs/world" } } },
      [`GET ${profileUrl}`]: { body: { [AVATAR_KEY]: { url: "mxc://hs/profile" } } },
    });
    expect((await resolveAvatar(auth, "!w:hs", "@u:hs"))?.url).toBe("mxc://hs/world");
  });

  test("falls back to the profile field, then undefined", async () => {
    mockFetch({
      [`GET ${memberUrl}`]: { body: { membership: "join" } },
      [`GET ${profileUrl}`]: { body: { [AVATAR_KEY]: { url: "mxc://hs/profile" } } },
    });
    expect((await resolveAvatar(auth, "!w:hs", "@u:hs"))?.url).toBe("mxc://hs/profile");

    mockFetch({ [`GET ${memberUrl}`]: { body: { membership: "join" } } });
    expect(await resolveAvatar(auth, "!w:hs", "@u:hs")).toBeUndefined();
  });

  test("still reads avatars saved under the old key name", async () => {
    mockFetch({
      [`GET ${memberUrl}`]: { body: { membership: "join", [LEGACY_AVATAR_KEY]: { url: "mxc://hs/old-world" } } },
    });
    expect((await resolveAvatar(auth, "!w:hs", "@u:hs"))?.url).toBe("mxc://hs/old-world");

    mockFetch({
      [`GET ${memberUrl}`]: { body: { membership: "join" } },
      [`GET ${legacyProfileUrl}`]: { body: { [LEGACY_AVATAR_KEY]: { url: "mxc://hs/old-profile" } } },
    });
    expect((await resolveAvatar(auth, "!w:hs", "@u:hs"))?.url).toBe("mxc://hs/old-profile");
  });
});

describe("setProfileAvatar", () => {
  test("writes the new key and removes the old one", async () => {
    const calls = mockFetch({
      [`PUT ${profileUrl}`]: { body: {} },
      [`DELETE ${legacyProfileUrl}`]: { body: {} },
    });
    await setProfileAvatar(auth, "@u:hs", { url: "mxc://hs/new" });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`PUT ${profileUrl}`, `DELETE ${legacyProfileUrl}`]);
    expect(calls[0].body).toEqual({ [AVATAR_KEY]: { url: "mxc://hs/new" } });
  });
});

describe("setWorldAvatar", () => {
  test("merges into the existing member event without dropping fields", async () => {
    const calls = mockFetch({
      [`GET ${memberUrl}`]: { body: { membership: "join", displayname: "U", avatar_url: "mxc://hs/pfp" } },
      [`PUT ${memberUrl}`]: { body: { event_id: "$e" } },
    });
    await setWorldAvatar(auth, "!w:hs", "@u:hs", { url: "mxc://hs/new" });
    expect(calls.at(-1)).toEqual({
      method: "PUT",
      url: memberUrl,
      body: { membership: "join", displayname: "U", avatar_url: "mxc://hs/pfp", [AVATAR_KEY]: { url: "mxc://hs/new" } },
    });
  });

  test("moves an avatar off the old key name", async () => {
    const calls = mockFetch({
      [`GET ${memberUrl}`]: { body: { membership: "join", [LEGACY_AVATAR_KEY]: { url: "mxc://hs/old" } } },
      [`PUT ${memberUrl}`]: { body: { event_id: "$e" } },
    });
    await setWorldAvatar(auth, "!w:hs", "@u:hs", { url: "mxc://hs/new" });
    expect(calls.at(-1)?.body).toEqual({ membership: "join", [AVATAR_KEY]: { url: "mxc://hs/new" } });
  });

  test("refuses when not joined", async () => {
    mockFetch({ [`GET ${memberUrl}`]: { body: { membership: "leave" } } });
    await expect(setWorldAvatar(auth, "!w:hs", "@u:hs", { url: "mxc://hs/new" })).rejects.toThrow(/joined/);
  });
});

describe("parseAvatarCollection", () => {
  test("keeps valid avatars once, drops malformed ones and bad builtin entries", () => {
    const collection = parseAvatarCollection({
      avatars: [
        { url: "mxc://glowers.club/abc", name: "Mint", added_ts: 5 },
        { url: "mxc://glowers.club/abc", name: "duplicate" },
        { url: "https://evil.example/x.glb" },
        "nonsense",
        { url: "mxc://matrix.org/def", preview_url: "mxc://matrix.org/pre", format: "glb" },
      ],
      builtin: { devil: "mxc://glowers.club/devil", rose: "http://not-mxc" },
    });
    expect(collection.avatars).toEqual([
      { url: "mxc://glowers.club/abc", name: "Mint", added_ts: 5 },
      { url: "mxc://matrix.org/def", preview_url: "mxc://matrix.org/pre", format: "glb", added_ts: 0 },
    ]);
    expect(collection.builtin).toEqual({ devil: "mxc://glowers.club/devil" });
  });

  test("missing or garbage account data is an empty collection", () => {
    expect(parseAvatarCollection(undefined)).toEqual({ avatars: [], builtin: {} });
    expect(parseAvatarCollection({ avatars: "x", builtin: 3 })).toEqual({ avatars: [], builtin: {} });
  });
});

describe("built-in avatar versions", () => {
  const collection = {
    avatars: [],
    builtin: {
      devil: "mxc://hs/old-devil",
      devil_preview: "mxc://hs/devil-preview",
      "devil@2": "mxc://hs/new-devil",
      rose: "mxc://hs/rose",
    },
  };

  test("an upload of an older version is outdated, the current one isn't", () => {
    expect(outdatedBuiltinForUrl(collection, "mxc://hs/old-devil")?.id).toBe("devil");
    expect(outdatedBuiltinForUrl(collection, "mxc://hs/new-devil")).toBeUndefined();
    expect(outdatedBuiltinForUrl(collection, "mxc://hs/rose")).toBeUndefined();
    expect(outdatedBuiltinForUrl(collection, "mxc://hs/devil-preview")).toBeUndefined();
    expect(outdatedBuiltinForUrl(collection, "mxc://hs/someone-else")).toBeUndefined();
  });

  test("every version of an upload maps back to its built-in id", () => {
    expect(builtinIdForUrl(collection, "mxc://hs/old-devil")).toBe("devil");
    expect(builtinIdForUrl(collection, "mxc://hs/new-devil")).toBe("devil");
    expect(builtinIdForUrl(collection, "mxc://hs/devil-preview")).toBeUndefined();
  });
});
