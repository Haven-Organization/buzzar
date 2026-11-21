/**
 * Buzzar's Matrix layer: end-to-end encryption for world-call set-up messages (the `m.call.*` to-device messages
 * that carry WebRTC offers, answers and network candidates between two devices).
 *
 * matrix-js-sdk's group calls can't encrypt these on its Rust crypto engine (its code path is unimplemented), and
 * sends them in the clear when told not to try. Buzzar builds from before plan 02 only accept them encrypted. So
 * the client's `sendToDevice` is wrapped here: call messages are Olm-encrypted for the receiving device when
 * possible, and sent in the clear only when they can't be (no encryption on this device, or the other device has
 * no keys), which newer builds still accept.
 */
import type { MatrixClient } from "matrix-js-sdk";

type ContentMap = Map<string, Map<string, Record<string, unknown>>>;

const STREAM_METADATA = "sdp_stream_metadata";
const STREAM_METADATA_UNSTABLE = "org.matrix.msc3077.sdp_stream_metadata";

/**
 * matrix-js-sdk labels the call's audio/video streams (which stream is someone's voice) under the stable key only;
 * builds from before plan 02 read only the unstable one, received the audio and never played it. Send both.
 */
function withUnstableStreamMetadata(content: Record<string, unknown>) {
  if (!(STREAM_METADATA in content) || STREAM_METADATA_UNSTABLE in content) return content;
  return { ...content, [STREAM_METADATA_UNSTABLE]: content[STREAM_METADATA] };
}

function isCallSignal(eventType: string) {
  return eventType.startsWith("m.call.") || eventType.startsWith("org.matrix.call.");
}

/** When each user's keys were last fetched because one of their devices was missing (so a device that really has no
 * keys isn't looked up again for every message of a call). */
const forcedQueries = new Map<string, number>();

/**
 * Makes sure the device we're calling is in our copy of its owner's device list. `getUserDeviceInfo(…, true)` only
 * downloads lists we don't track yet; a list we do track is trusted until sync says it changed, and that notice can
 * be missed (seen under sliding sync), so a device signed in since then is "unknown" and couldn't be encrypted for.
 * Then the user's keys are fetched from the server right away.
 */
async function ensureDeviceKnown(client: MatrixClient, userId: string, deviceId: string) {
  const crypto = client.getCrypto();
  if (!crypto) return;
  const known = await crypto.getUserDeviceInfo([userId]);
  if (known.get(userId)?.has(deviceId)) return;
  if (Date.now() - (forcedQueries.get(userId) ?? 0) < 10_000) return;
  forcedQueries.set(userId, Date.now());
  // matrix-js-sdk has no public "fetch this user's keys again"; its Rust crypto does exactly this internally (e.g.
  // before verifying with someone).
  const rust = crypto as unknown as {
    olmMachine?: { queryKeysForUsers(users: unknown[]): unknown };
    outgoingRequestProcessor?: { makeOutgoingRequest(request: unknown): Promise<void> };
  };
  if (!rust.olmMachine || !rust.outgoingRequestProcessor) return;
  const { UserId } = await import("@matrix-org/matrix-sdk-crypto-wasm");
  await rust.outgoingRequestProcessor.makeOutgoingRequest(rust.olmMachine.queryKeysForUsers([new UserId(userId)]));
}

export function encryptCallSignalling(client: MatrixClient) {
  const sendPlain = client.sendToDevice.bind(client);
  /** Users whose device list was fetched recently (so their devices' keys are known). */
  const fetched = new Map<string, number>();

  client.sendToDevice = async (eventType: string, contentMap: ContentMap, txnId?: string) => {
    if (!isCallSignal(eventType)) return sendPlain(eventType, contentMap, txnId);
    contentMap = new Map(
      [...contentMap].map(([userId, devices]) => [
        userId,
        new Map([...devices].map(([deviceId, content]) => [deviceId, withUnstableStreamMetadata(content)])),
      ])
    );
    const crypto = client.getCrypto();
    if (!crypto) return sendPlain(eventType, contentMap, txnId);

    const plain: ContentMap = new Map();
    for (const [userId, devices] of contentMap) {
      for (const [deviceId, content] of devices) {
        let encrypted = false;
        try {
          if (Date.now() - (fetched.get(userId) ?? 0) > 60_000) {
            await crypto.getUserDeviceInfo([userId], true);
            fetched.set(userId, Date.now());
          }
          await ensureDeviceKnown(client, userId, deviceId);
          const batch = await crypto.encryptToDeviceMessages(eventType, [{ userId, deviceId }], content);
          if (batch.batch.length > 0) {
            await client.queueToDevice(batch);
            encrypted = true;
          }
        } catch (e) {
          console.warn(`Couldn't encrypt a call message for ${userId} ${deviceId}; sending it unencrypted`, e);
        }
        if (!encrypted) {
          let forUser = plain.get(userId);
          if (!forUser) plain.set(userId, (forUser = new Map()));
          forUser.set(deviceId, content);
        }
      }
    }
    if (plain.size > 0) return sendPlain(eventType, plain, txnId);
    return {};
  };
}
