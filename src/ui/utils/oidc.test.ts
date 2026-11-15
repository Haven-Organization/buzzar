import { afterEach, describe, expect, test, vi } from "vitest";

import { discoverOidcIssuer, isLoopbackOrigin, oidcRedirectUri } from "./oidc";

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = routes[url];
      return {
        ok: body !== undefined,
        status: body !== undefined ? 200 : 404,
        json: async () => body,
      } as Response;
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discoverOidcIssuer", () => {
  const hs = "https://matrix-client.example.org";

  test("stable auth_metadata (MAS on Matrix 1.15+)", async () => {
    mockFetch({
      [`${hs}/_matrix/client/v1/auth_metadata`]: {
        issuer: "https://account.example.org/",
        authorization_endpoint: "https://account.example.org/authorize",
        account_management_uri: "https://account.example.org/account/",
      },
    });
    expect(await discoverOidcIssuer(`${hs}/`)).toEqual({
      issuer: "https://account.example.org/",
      account: "https://account.example.org/account/",
    });
  });

  test("unstable MSC2965 auth_metadata", async () => {
    mockFetch({
      [`${hs}/_matrix/client/unstable/org.matrix.msc2965/auth_metadata`]: {
        issuer: "https://auth.example.org/",
        authorization_endpoint: "https://auth.example.org/authorize",
      },
    });
    expect(await discoverOidcIssuer(hs)).toEqual({ issuer: "https://auth.example.org/", account: "" });
  });

  test("first MSC2965 auth_issuer", async () => {
    mockFetch({ [`${hs}/_matrix/client/unstable/org.matrix.msc2965/auth_issuer`]: { issuer: "https://old.example/" } });
    expect(await discoverOidcIssuer(hs)).toEqual({ issuer: "https://old.example/", account: "" });
  });

  test("password-only homeserver", async () => {
    mockFetch({});
    expect(await discoverOidcIssuer(hs)).toBeUndefined();
  });
});

describe("redirect and loopback", () => {
  test("redirect URI is the origin with a slash", () => {
    expect(oidcRedirectUri("https://buzzar.example")).toBe("https://buzzar.example/");
  });

  test("loopback origins register as native clients", () => {
    expect(isLoopbackOrigin("http://localhost:3000")).toBe(true);
    expect(isLoopbackOrigin("http://127.0.0.1:8090")).toBe(true);
    expect(isLoopbackOrigin("https://buzzar.haven.software")).toBe(false);
  });
});
