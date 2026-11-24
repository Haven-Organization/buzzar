import { describe, expect, it } from "vitest";

import {
  DEFAULT_INSTANCE_CAP,
  instanceName,
  isInstanceId,
  liveKitRoomName,
  MAIN_INSTANCE,
  newInstanceId,
  parseInstanceCap,
  pickInstance,
  sortInstances,
  WorldInstance,
} from "./instances";

const inst = (id: string, people: number, since = 0): WorldInstance => ({
  id,
  userIds: Array.from({ length: people }, (_, i) => `@u${i}:x`),
  since,
});

describe("world instances", () => {
  it("makes and checks instance IDs", () => {
    const id = newInstanceId(undefined, () => 0.5);
    expect(id).toBe("i-55000");
    expect(isInstanceId(id)).toBe(true);
    expect(isInstanceId(MAIN_INSTANCE)).toBe(true);
    expect(isInstanceId("i-123")).toBe(false);
    expect(isInstanceId("i-12345~a/b")).toBe(false);
    expect(isInstanceId("../x")).toBe(false);
    expect(isInstanceId(undefined)).toBe(false);
  });

  it("keeps names in the ID", () => {
    const id = newInstanceId("  Movie   Night 🎬 ", () => 0);
    expect(id).toBe(`i-10000~${encodeURIComponent("Movie Night 🎬")}`);
    expect(isInstanceId(id)).toBe(true);
    expect(instanceName(id)).toBe("Movie Night 🎬");
    expect(instanceName("i-48213")).toBe("#48213");
    expect(instanceName(MAIN_INSTANCE)).toBe("Main");
    expect(instanceName("i-48213~%E0%A4")).toBe("#48213");
    expect(newInstanceId("x".repeat(80), () => 0).length).toBe("i-10000~".length + 40);
    expect(newInstanceId("   ", () => 0)).toBe("i-10000");
    // Long encodings are cut by whole characters, staying valid.
    const emoji = newInstanceId("🎬".repeat(40), () => 0);
    expect(isInstanceId(emoji)).toBe(true);
    expect(instanceName(emoji)).toBe("🎬".repeat(8));
  });

  it("keeps main's LiveKit room as before", () => {
    expect(liveKitRoomName("!r:x", MAIN_INSTANCE)).toBe("!r:x");
    expect(liveKitRoomName("!r:x", "i-48213")).toBe("!r:x|i-48213");
  });

  it("reads the cap", () => {
    expect(parseInstanceCap(undefined)).toBe(DEFAULT_INSTANCE_CAP);
    expect(parseInstanceCap({ instance_cap: 12 })).toBe(12);
    expect(parseInstanceCap({ instance_cap: 1 })).toBe(2);
    expect(parseInstanceCap({ instance_cap: 9999 })).toBe(500);
    expect(parseInstanceCap({ instance_cap: 3.5 })).toBe(DEFAULT_INSTANCE_CAP);
  });

  it("enters main when nobody's there", () => {
    expect(pickInstance([], 10)).toEqual({ id: MAIN_INSTANCE, isNew: true });
    expect(pickInstance([inst("i-11111", 0)], 10)).toEqual({ id: MAIN_INSTANCE, isNew: true });
  });

  it("fills the busiest instance with room", () => {
    const instances = [inst(MAIN_INSTANCE, 3), inst("i-22222", 7, 5), inst("i-33333", 10, 1)];
    expect(pickInstance(instances, 10)).toEqual({ id: "i-22222", isNew: false });
  });

  it("prefers main on a tie", () => {
    expect(pickInstance([inst("i-22222", 4, 1), inst(MAIN_INSTANCE, 4, 9)], 10).id).toBe(MAIN_INSTANCE);
  });

  it("starts a new instance when every one is full", () => {
    const picked = pickInstance([inst(MAIN_INSTANCE, 10)], 10, undefined, () => 0);
    expect(picked).toEqual({ id: "i-10000", isNew: true });
  });

  it("honours a request: an instance, even a full one, or a new one", () => {
    expect(pickInstance([inst(MAIN_INSTANCE, 10)], 10, MAIN_INSTANCE)).toEqual({ id: MAIN_INSTANCE, isNew: false });
    expect(pickInstance([inst(MAIN_INSTANCE, 1)], 10, "new", () => 0).isNew).toBe(true);
    expect(pickInstance([], 10, "i-44444")).toEqual({ id: "i-44444", isNew: true });
    // A link whose name arrived decoded still finds the instance.
    expect(pickInstance([], 10, "i-12345~Test Room B").id).toBe("i-12345~Test%20Room%20B");
    // Nonsense requests are ignored.
    expect(pickInstance([inst(MAIN_INSTANCE, 1)], 10, "bogus").id).toBe(MAIN_INSTANCE);
  });

  it("lists instances main first, then oldest", () => {
    const sorted = sortInstances([inst("i-20000", 1, 20), inst("i-10000", 1, 10), inst(MAIN_INSTANCE, 1, 30)]);
    expect(sorted.map((i) => i.id)).toEqual([MAIN_INSTANCE, "i-10000", "i-20000"]);
  });
});
