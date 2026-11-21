import { afterEach, describe, expect, it, vi } from "vitest";

import { Session } from "../../matrix";
import { resolveDestination } from "./usePortalDestination";

const auth = { homeserver: "https://hs.example/", accessToken: "tok" };

function sessionWith(rooms: Record<string, unknown>) {
  const map = new Map(Object.entries(rooms));
  return { rooms: map } as unknown as Session;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveDestination", () => {
  it("uses a joined world's own name, members and scene preview", async () => {
    const room = {
      id: "!w:hs",
      name: "Backrooms",
      canonicalAlias: "#back:hs",
      joinedMemberCount: 3,
      avatarUrl: "mxc://hs/avatar",
      getStateEvent: async (type: string) =>
        type === "org.matrix.msc3815.world"
          ? { event: { content: { scene_preview_url: "mxc://hs/preview" } } }
          : { event: { content: { topic: "Yellow" } } },
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await resolveDestination(sessionWith({ "!w:hs": room }), async () => auth, "matrix:r/back:hs");
    expect(result).toEqual({ name: "Backrooms", topic: "Yellow", members: 3, image: "mxc://hs/preview" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks the room summary API for worlds you haven't joined", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ name: "Maze", num_joined_members: 5, avatar_url: "mxc://hs/a", topic: "Lost" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await resolveDestination(sessionWith({}), async () => auth, "matrix:r/maze:other?via=other");
    expect(result).toEqual({ name: "Maze", topic: "Lost", members: 5, image: "mxc://hs/a" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hs.example/_matrix/client/v1/room_summary/%23maze%3Aother?via=other",
      expect.anything()
    );
  });

  it("returns nothing when the summary isn't available, and flags web links", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false }))
    );
    expect(await resolveDestination(sessionWith({}), async () => auth, "matrix:r/gone:hs")).toBeUndefined();
    expect(await resolveDestination(sessionWith({}), async () => auth, "https://example.org/page")).toEqual({
      name: "example.org",
      web: true,
    });
  });
});
