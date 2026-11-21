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

function isCallSignal(eventType: string) {
  return eventType.startsWith("m.call.") || eventType.startsWith("org.matrix.call.");
}

export function encryptCallSignalling(client: MatrixClient) {
  const sendPlain = client.sendToDevice.bind(client);
  /** Users whose device list was fetched recently (so their devices' keys are known). */
  const fetched = new Map<string, number>();

  client.sendToDevice = async (eventType: string, contentMap: ContentMap, txnId?: string) => {
    const crypto = client.getCrypto();
    if (!crypto || !isCallSignal(eventType)) return sendPlain(eventType, contentMap, txnId);

    const plain: ContentMap = new Map();
    for (const [userId, devices] of contentMap) {
      for (const [deviceId, content] of devices) {
        let encrypted = false;
        try {
          if (Date.now() - (fetched.get(userId) ?? 0) > 60_000) {
            await crypto.getUserDeviceInfo([userId], true);
            fetched.set(userId, Date.now());
          }
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
