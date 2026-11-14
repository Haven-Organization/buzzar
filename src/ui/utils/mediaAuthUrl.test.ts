import { describe, expect, test } from "vitest";

import { toAuthenticatedMediaUrl, versionsSupportAuthenticatedMedia } from "./mediaAuthUrl";

const HS = "https://matrix-client.matrix.org";

describe("toAuthenticatedMediaUrl", () => {
  test("rewrites legacy download URLs for the session homeserver", () => {
    expect(toAuthenticatedMediaUrl(`${HS}/_matrix/media/r0/download/thirdroom.io/abc`, HS)).toBe(
      `${HS}/_matrix/client/v1/media/download/thirdroom.io/abc`
    );
  });

  test("rewrites thumbnails and keeps the query string", () => {
    expect(
      toAuthenticatedMediaUrl(`${HS}/_matrix/media/r0/thumbnail/example.org/x?width=64&height=64&method=crop`, HS)
    ).toBe(`${HS}/_matrix/client/v1/media/thumbnail/example.org/x?width=64&height=64&method=crop`);
  });

  test("tolerates a trailing slash on the homeserver", () => {
    expect(toAuthenticatedMediaUrl(`${HS}/_matrix/media/r0/download/a/b`, `${HS}/`)).toBe(
      `${HS}/_matrix/client/v1/media/download/a/b`
    );
  });

  test("never matches another origin (token must not leak)", () => {
    expect(toAuthenticatedMediaUrl("https://evil.example/_matrix/media/r0/download/a/b", HS)).toBeUndefined();
    expect(toAuthenticatedMediaUrl(`${HS}.evil.example/_matrix/media/r0/download/a/b`, HS)).toBeUndefined();
  });

  test("ignores non-media endpoints", () => {
    expect(toAuthenticatedMediaUrl(`${HS}/_matrix/media/r0/upload`, HS)).toBeUndefined();
    expect(toAuthenticatedMediaUrl(`${HS}/_matrix/media/r0/config`, HS)).toBeUndefined();
  });
});

describe("versionsSupportAuthenticatedMedia", () => {
  test("requires spec v1.11+", () => {
    expect(versionsSupportAuthenticatedMedia(["r0.6.1", "v1.1", "v1.10"])).toBe(false);
    expect(versionsSupportAuthenticatedMedia(["v1.10", "v1.11"])).toBe(true);
    expect(versionsSupportAuthenticatedMedia(["v1.17"])).toBe(true);
    expect(versionsSupportAuthenticatedMedia(undefined)).toBe(false);
  });
});
