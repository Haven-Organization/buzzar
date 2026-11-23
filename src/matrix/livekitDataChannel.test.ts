import { describe, expect, it } from "vitest";

import { CHUNK_PAYLOAD_BYTES, ChunkAssembler, chunkMessage, LiveKitDataChannel } from "./livekitDataChannel";

const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

describe("chunking", () => {
  it("sends small messages in one chunk and reassembles them", () => {
    const message = bytes(100);
    const chunks = chunkMessage(message, 7);
    expect(chunks).toHaveLength(1);
    const assembler = new ChunkAssembler();
    expect(new Uint8Array(assembler.add(chunks[0])!)).toEqual(message);
  });

  it("splits big messages and puts them back together", () => {
    const message = bytes(CHUNK_PAYLOAD_BYTES * 3 + 5);
    const chunks = chunkMessage(message, 1);
    expect(chunks).toHaveLength(4);
    const assembler = new ChunkAssembler();
    const results = chunks.map((chunk) => assembler.add(chunk));
    expect(results.slice(0, 3)).toEqual([undefined, undefined, undefined]);
    expect(new Uint8Array(results[3]!)).toEqual(message);
  });

  it("handles empty messages", () => {
    const chunks = chunkMessage(new Uint8Array(0), 0);
    expect(chunks).toHaveLength(1);
    expect(new ChunkAssembler().add(chunks[0])!.byteLength).toBe(0);
  });

  it("drops a message with a missing chunk and carries on with the next", () => {
    const first = chunkMessage(bytes(CHUNK_PAYLOAD_BYTES * 2), 1);
    const second = bytes(10, 9);
    const assembler = new ChunkAssembler();
    assembler.add(first[0]);
    // first[1] lost; a later message's middle chunk would be out of sequence
    expect(assembler.add(chunkMessage(bytes(CHUNK_PAYLOAD_BYTES * 2), 2)[1])).toBeUndefined();
    expect(new Uint8Array(assembler.add(chunkMessage(second, 3)[0])!)).toEqual(second);
  });
});

describe("LiveKitDataChannel", () => {
  it("delivers what one end sends to the other, in order", async () => {
    let receiver: LiveKitDataChannel | undefined = undefined;
    const sender = new LiveKitDataChannel(async (chunk) => receiver!.receive(chunk));
    receiver = new LiveKitDataChannel(async () => undefined);
    const got: Uint8Array[] = [];
    receiver.addEventListener("message", (e) => got.push(new Uint8Array((e as MessageEvent).data)));
    sender.open();
    receiver.open();

    const big = bytes(CHUNK_PAYLOAD_BYTES * 2 + 1, 3);
    const buffer = bytes(4, 5);
    sender.send(buffer);
    buffer.fill(0); // the engine reuses its buffers right after sending
    sender.send(big.buffer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(got).toEqual([bytes(4, 5), big]);
  });

  it("keeps messages that arrive before anyone listens, and delivers them in order once someone does", async () => {
    const channel = new LiveKitDataChannel(async () => undefined);
    channel.open();
    channel.receive(chunkMessage(bytes(3, 1), 0)[0]);
    channel.receive(chunkMessage(bytes(3, 2), 1)[0]);
    const got: Uint8Array[] = [];
    channel.addEventListener("message", (e) => got.push(new Uint8Array((e as MessageEvent).data)));
    expect(got).toEqual([]);
    await Promise.resolve();
    channel.receive(chunkMessage(bytes(3, 3), 2)[0]);
    expect(got).toEqual([bytes(3, 1), bytes(3, 2), bytes(3, 3)]);
  });

  it("refuses to send before it's open", () => {
    const channel = new LiveKitDataChannel(async () => undefined);
    expect(() => channel.send(new Uint8Array(1))).toThrow();
  });
});
