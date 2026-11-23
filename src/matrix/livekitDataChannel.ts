/**
 * Buzzar: the game's data channel to one player, carried as LiveKit data packets.
 *
 * The engine (network.main.ts) talks to an RTCDataChannel per peer: `send`, `readyState`, `ordered`, `binaryType` and
 * "open"/"message"/"close" events. In a LiveKit call there's no channel per peer, so this stands in for one: sends go
 * out as reliable packets addressed to that player only, and the call hands it the packets that player sent us.
 *
 * LiveKit limits the size of a data packet, and a world's snapshot can be bigger, so each message is cut into chunks
 * with a small header (message number, chunk index, chunk count) and put back together on arrival. Reliable packets
 * from one sender arrive in order, so one message is assembled at a time.
 */

/** Payload bytes per chunk: comfortably under LiveKit's reliable packet limit (about 15 KiB with its overhead). */
export const CHUNK_PAYLOAD_BYTES = 14000;
const HEADER_BYTES = 8;

export type ChunkSender = (chunk: Uint8Array<ArrayBuffer>) => Promise<void>;

/** Splits a message into chunks: [u32 message number][u16 index][u16 count][payload]. */
export function chunkMessage(message: Uint8Array, messageNumber: number): Uint8Array<ArrayBuffer>[] {
  const count = Math.max(1, Math.ceil(message.byteLength / CHUNK_PAYLOAD_BYTES));
  if (count > 0xffff) throw new Error(`Message too big to send (${message.byteLength} bytes)`);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let index = 0; index < count; index++) {
    const payload = message.subarray(index * CHUNK_PAYLOAD_BYTES, (index + 1) * CHUNK_PAYLOAD_BYTES);
    const chunk = new Uint8Array(HEADER_BYTES + payload.byteLength);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, messageNumber >>> 0);
    view.setUint16(4, index);
    view.setUint16(6, count);
    chunk.set(payload, HEADER_BYTES);
    chunks.push(chunk);
  }
  return chunks;
}

/** Puts chunked messages back together. `add` returns the whole message once its last chunk is in. */
export class ChunkAssembler {
  private messageNumber = -1;
  private parts: Uint8Array[] = [];
  private expected = 0;

  add(chunk: Uint8Array): ArrayBuffer | undefined {
    if (chunk.byteLength < HEADER_BYTES) return undefined;
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const messageNumber = view.getUint32(0);
    const index = view.getUint16(4);
    const count = view.getUint16(6);
    const payload = chunk.subarray(HEADER_BYTES);

    if (index === 0) {
      this.messageNumber = messageNumber;
      this.parts = [];
      this.expected = count;
    } else if (messageNumber !== this.messageNumber || index !== this.parts.length) {
      // A chunk went missing (e.g. the sender reconnected): drop the partial message.
      this.parts = [];
      this.messageNumber = -1;
      return undefined;
    }
    this.parts.push(payload);
    if (this.parts.length < this.expected) return undefined;

    const total = this.parts.reduce((sum, part) => sum + part.byteLength, 0);
    const message = new Uint8Array(total);
    let offset = 0;
    for (const part of this.parts) {
      message.set(part, offset);
      offset += part.byteLength;
    }
    this.parts = [];
    this.messageNumber = -1;
    return message.buffer;
  }
}

/** Enough of RTCDataChannel for the engine (see the top of this file). */
export class LiveKitDataChannel extends EventTarget {
  readonly ordered = true;
  readonly label = "buzzar";
  binaryType: BinaryType = "arraybuffer";
  readyState: RTCDataChannelState = "connecting";
  private nextMessage = 0;
  private sending: Promise<void> = Promise.resolve();
  private assembler = new ChunkAssembler();

  constructor(private sendChunk: ChunkSender) {
    super();
  }

  send(data: string | Blob | ArrayBuffer | ArrayBufferView) {
    if (this.readyState !== "open") throw new Error("Data channel is not open");
    let bytes: Uint8Array;
    if (typeof data === "string") bytes = new TextEncoder().encode(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else if (typeof Blob !== "undefined" && data instanceof Blob) throw new Error("Blobs aren't supported");
    // An ArrayBuffer (or SharedArrayBuffer, or one from another realm: `instanceof` would miss those).
    else bytes = new Uint8Array(data as ArrayBufferLike);
    // Copied now: the engine reuses its buffers as soon as send returns.
    const chunks = chunkMessage(bytes.slice(), this.nextMessage++);
    for (const chunk of chunks) {
      this.sending = this.sending
        .then(() => this.sendChunk(chunk))
        .catch((err) => console.warn("LiveKit send failed", err));
    }
  }

  /** @internal A packet this player sent us. */
  receive(chunk: Uint8Array) {
    if (this.readyState !== "open") return;
    const message = this.assembler.add(chunk);
    if (message) this.dispatchEvent(new MessageEvent("message", { data: message }));
  }

  /** @internal */
  open() {
    if (this.readyState === "open") return;
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }

  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.assembler = new ChunkAssembler();
    this.dispatchEvent(new Event("close"));
  }
}
