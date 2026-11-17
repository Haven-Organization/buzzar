import { coversLatest, ownReadReceipts } from "./readSync";

describe("ownReadReceipts", () => {
  const me = "@q:glowers.club";
  it("finds public and private receipts for the own user only", () => {
    const detail = {
      roomId: "!r",
      events: [
        { type: "m.typing", content: { user_ids: [me] } },
        {
          type: "m.receipt",
          content: {
            $a: { "m.read": { [me]: { ts: 10 }, "@other:x": { ts: 11 } } },
            $b: { "m.read.private": { [me]: { ts: 20 } } },
            $c: { "m.read": { "@other:x": { ts: 30 } } },
          },
        },
      ],
    };
    expect(ownReadReceipts(detail, me)).toEqual([
      { eventId: "$a", ts: 10 },
      { eventId: "$b", ts: 20 },
    ]);
  });

  it("ignores malformed content", () => {
    const detail = { roomId: "!r", events: [{ type: "m.receipt", content: { $a: null, $b: { "m.read": 5 } } }] };
    expect(ownReadReceipts(detail, me)).toEqual([]);
  });
});

describe("coversLatest", () => {
  it("matches the latest event id", () => {
    expect(coversLatest({ eventId: "$last" }, "$last", 100)).toBe(true);
  });
  it("accepts a receipt made after the latest message was sent", () => {
    expect(coversLatest({ eventId: "$older", ts: 150 }, "$last", 100)).toBe(true);
  });
  it("rejects an older receipt", () => {
    expect(coversLatest({ eventId: "$older", ts: 50 }, "$last", 100)).toBe(false);
    expect(coversLatest({ eventId: "$older" }, "$last", 100)).toBe(false);
  });
});
