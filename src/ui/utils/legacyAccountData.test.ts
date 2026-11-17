import { afterEach, describe, expect, test, vi } from "vitest";

import { getAccountData } from "./legacyAccountData";

const auth = { homeserver: "https://hs.example", accessToken: "tok" };
const url = (type: string) => `https://hs.example/_matrix/client/v3/user/%40u%3Ahs/account_data/${type}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(store: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${u}`);
      if (method === "PUT") {
        store[u] = JSON.parse(init?.body as string);
        return new Response("{}", { status: 200 });
      }
      return u in store ? new Response(JSON.stringify(store[u]), { status: 200 }) : new Response("{}", { status: 404 });
    })
  );
  return calls;
}

describe("getAccountData", () => {
  test("returns the new type when it exists, without touching the old one", async () => {
    const calls = mockFetch({ [url("software.haven.world.space")]: { room_id: "!new" } });
    const res = await getAccountData(auth, "@u:hs", "software.haven.world.space");
    expect(await res.json()).toEqual({ room_id: "!new" });
    expect(calls).toEqual([`GET ${url("software.haven.world.space")}`]);
  });

  test("moves old content to the new type and empties the old one", async () => {
    const store: Record<string, unknown> = { [url("software.haven.space")]: { room_id: "!old" } };
    mockFetch(store);
    const res = await getAccountData(auth, "@u:hs", "software.haven.world.space");
    expect(await res.json()).toEqual({ room_id: "!old" });
    expect(store[url("software.haven.world.space")]).toEqual({ room_id: "!old" });
    expect(store[url("software.haven.space")]).toEqual({});
  });

  test("is a 404 when neither exists, or the old one was already emptied", async () => {
    mockFetch({});
    expect((await getAccountData(auth, "@u:hs", "software.haven.world.avatars")).status).toBe(404);
    mockFetch({ [url("software.haven.avatars")]: {} });
    expect((await getAccountData(auth, "@u:hs", "software.haven.world.avatars")).status).toBe(404);
  });
});
