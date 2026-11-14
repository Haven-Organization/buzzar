import { afterEach, describe, expect, test, vi } from "vitest";

import { AVATAR_KEY, parseAvatarContent, resolveAvatar, setWorldAvatar } from "./avatarMatrix";

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

  test("refuses when not joined", async () => {
    mockFetch({ [`GET ${memberUrl}`]: { body: { membership: "leave" } } });
    await expect(setWorldAvatar(auth, "!w:hs", "@u:hs", { url: "mxc://hs/new" })).rejects.toThrow(/joined/);
  });
});
