/**
 * Buzzar: verifying this device for end-to-end encryption, like Element does after sign-in. Either another of the
 * user's devices confirms it with emoji (SAS), or the recovery key unlocks secret storage and this device signs
 * itself with the account's self-signing key.
 */
import { CrossSigning, Platform, Session } from "@thirdroom/hydrogen-view-sdk";

import { getSessionAuth } from "./avatarMatrix";

export type DeviceVerificationStatus =
  /** No encryption support (no olm) or the status couldn't be read. */
  | "unavailable"
  /** The account never set up cross-signing, so there's nothing to verify against. */
  | "no-cross-signing"
  | "unverified"
  | "verified";

interface KeysQueryResponse {
  master_keys?: Record<string, { keys: Record<string, string> }>;
  self_signing_keys?: Record<string, { keys: Record<string, string> }>;
  device_keys?: Record<string, Record<string, { signatures?: Record<string, Record<string, string>> }>>;
}

/** Reads, from the homeserver, whether this device is signed by the account's self-signing key. */
export async function getDeviceVerificationStatus(
  session: Session,
  platform: Platform,
  sessionId: string | undefined
): Promise<DeviceVerificationStatus> {
  if (!session.hasIdentity) return "unavailable";
  const auth = await getSessionAuth(platform as never, sessionId);
  if (!auth) return "unavailable";
  const { userId, deviceId } = session;
  try {
    const res = await fetch(`${auth.homeserver.replace(/\/+$/, "")}/_matrix/client/v3/keys/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ device_keys: { [userId]: [deviceId] } }),
    });
    if (!res.ok) return "unavailable";
    const body = (await res.json()) as KeysQueryResponse;
    if (!body.master_keys?.[userId]) return "no-cross-signing";
    const sskKeys = body.self_signing_keys?.[userId]?.keys;
    const sskKeyId = sskKeys && Object.keys(sskKeys)[0];
    const signatures = body.device_keys?.[userId]?.[deviceId]?.signatures?.[userId];
    return sskKeyId && signatures?.[sskKeyId] ? "verified" : "unverified";
  } catch {
    return "unavailable";
  }
}

type SessionInternals = Record<
  | "_storage"
  | "_platform"
  | "_olm"
  | "_olmUtil"
  | "_deviceTracker"
  | "_deviceMessageHandler"
  | "_hsApi"
  | "_e2eeAccount",
  unknown
>;

/**
 * The cross-signing object that runs SAS. Hydrogen only creates one after secret storage is unlocked, but a new
 * device verifying from another device doesn't have the recovery key: the other device does the signing. So
 * without one, make a temporary one with empty secret storage (it can verify, just not sign anything itself).
 */
export function crossSigningForVerification(session: Session): { crossSigning: CrossSigning; dispose: () => void } {
  const existing = session.crossSigning.get();
  if (existing) return { crossSigning: existing, dispose: () => undefined };
  const internals = session as unknown as SessionInternals;
  const crossSigning = new CrossSigning({
    storage: internals._storage,
    secretStorage: { readSecret: async () => undefined },
    platform: internals._platform,
    olm: internals._olm,
    olmUtil: internals._olmUtil,
    deviceTracker: internals._deviceTracker,
    deviceMessageHandler: internals._deviceMessageHandler,
    hsApi: internals._hsApi,
    ownUserId: session.userId,
    e2eeAccount: internals._e2eeAccount,
    deviceId: session.deviceId,
  });
  return { crossSigning, dispose: () => crossSigning.dispose() };
}

/** Recovery keys are 48 base58 characters, usually shown in groups of four. */
function looksLikeRecoveryKey(input: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{48}$/.test(input.replace(/\s+/g, ""));
}

/**
 * Unlocks secret storage with a recovery key (or security phrase), then signs this device with the account's
 * self-signing key so other devices and people see it as verified.
 */
export async function verifyWithRecoveryKey(session: Session, platform: Platform, input: string) {
  const credential = input.trim();
  if (!credential) throw new Error("Enter your recovery key.");
  // 0 = recovery key, 1 = security phrase. Try the likelier one first.
  const types: (0 | 1)[] = looksLikeRecoveryKey(credential) ? [0, 1] : [1, 0];
  let unlocked = false;
  for (const type of types) {
    try {
      await session.enableSecretStorage(type, credential);
      unlocked = true;
      break;
    } catch {
      // try the other kind
    }
  }
  if (!unlocked) throw new Error("That recovery key didn't work. Check it and try again.");

  const crossSigning = session.crossSigning.get();
  if (!crossSigning?.isMasterKeyTrusted) {
    throw new Error("Your recovery key worked, but this account's cross-signing keys couldn't be loaded.");
  }
  const signed = await platform.logger.run("Buzzar: sign own device", (log) => crossSigning.signOwnDevice(log));
  if (!signed) throw new Error("Your recovery key worked, but this device couldn't be signed. Try again.");
}

export function skippedVerificationKey(session: Session) {
  return `buzzar_verification_skipped:${session.userId}:${session.deviceId}`;
}
