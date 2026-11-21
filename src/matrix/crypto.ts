/**
 * Buzzar's Matrix layer (plan 02): verifying this device for end-to-end encryption, on matrix-js-sdk's Rust crypto.
 * Either another of the user's devices confirms it with emoji (SAS), or the recovery key unlocks secret storage
 * and this device signs itself. Either way the device then gets the key backup, so older messages decrypt.
 */
import { VerificationPhase, VerificationRequestEvent, VerifierEvent } from "matrix-js-sdk/lib/crypto-api";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key";
import { deriveRecoveryKeyFromPassphrase } from "matrix-js-sdk/lib/crypto-api/key-passphrase";

import type { ShowSasCallbacks, VerificationRequest, Verifier } from "matrix-js-sdk/lib/crypto-api";
import type { Session } from "./session";

export type DeviceVerificationStatus =
  /** No encryption support or the status couldn't be read. */
  | "unavailable"
  /** The account never set up cross-signing, so there's nothing to verify against. */
  | "no-cross-signing"
  | "unverified"
  | "verified";

/** The secret storage key the user just entered, handed to the SDK when it asks (see `secretStorageCallbacks`). */
let enteredKey: { keyId: string; key: Uint8Array<ArrayBuffer> } | undefined;

/** `cryptoCallbacks` for createClient: answers secret storage requests with the key the user entered. */
export const secretStorageCallbacks = {
  getSecretStorageKey: async ({
    keys,
  }: {
    keys: Record<string, unknown>;
  }): Promise<[string, Uint8Array<ArrayBuffer>] | null> => {
    if (enteredKey && enteredKey.keyId in keys) return [enteredKey.keyId, enteredKey.key];
    return null;
  },
};

export async function getDeviceVerificationStatus(session: Session): Promise<DeviceVerificationStatus> {
  const crypto = session.client.getCrypto();
  if (!crypto) return "unavailable";
  try {
    if (!(await crypto.userHasCrossSigningKeys(session.userId, true))) return "no-cross-signing";
    const status = await crypto.getDeviceVerificationStatus(session.userId, session.deviceId);
    return status?.crossSigningVerified ? "verified" : "unverified";
  } catch (e) {
    console.warn("Couldn't read this device's verification status", e);
    return "unavailable";
  }
}

/** Whether this device has the key backup (so it can read older encrypted messages). */
export async function hasKeyBackup(session: Session): Promise<boolean> {
  const crypto = session.client.getCrypto();
  if (!crypto) return false;
  try {
    return (await crypto.getActiveSessionBackupVersion()) !== null;
  } catch {
    return false;
  }
}

export type KeyBackupOutcome =
  /** The online backup is on for this device; older messages are being restored from it. */
  | "active"
  /** The account has no online backup, so there's nothing to fetch. */
  | "none"
  /** There is a backup, but its key never reached this device (the recovery key can still unlock it). */
  | "missing";

/**
 * Turns on the account's online key backup for this device and restores older messages' keys from it. After a
 * verification, the other device sends the backup key over a few moments later, so this waits for it (up to
 * `timeoutMs`) instead of asking for the recovery key straight away.
 */
export async function waitForKeyBackup(session: Session, timeoutMs = 30000): Promise<KeyBackupOutcome> {
  const crypto = session.client.getCrypto();
  if (!crypto) return "none";
  try {
    if (!(await crypto.getKeyBackupInfo())) return "none";
  } catch {
    // couldn't ask the server: keep trying below
  }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await crypto.getActiveSessionBackupVersion()) === null) {
        if (!(await crypto.getSessionBackupPrivateKey())) {
          // After a recovery key was entered the backup key is in secret storage; otherwise this does nothing.
          await crypto.loadSessionBackupPrivateKeyFromSecretStorage().catch(() => undefined);
        }
        if (await crypto.getSessionBackupPrivateKey()) await crypto.checkKeyBackupAndEnable();
      }
      if ((await crypto.getActiveSessionBackupVersion()) !== null) {
        // Fetch the old messages' keys in the background.
        crypto.restoreKeyBackup().catch((e) => console.warn("Couldn't restore the key backup", e));
        return "active";
      }
    } catch (e) {
      console.warn("Couldn't enable the key backup yet", e);
    }
    if (Date.now() >= deadline) return "missing";
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

/** Recovery keys are 48 base58 characters, usually shown in groups of four. */
function looksLikeRecoveryKey(input: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{48}$/.test(input.replace(/\s+/g, ""));
}

/**
 * Unlocks secret storage with a recovery key (or security phrase), then signs this device with the account's
 * self-signing key so other devices and people see it as verified, and turns on the key backup.
 */
export async function verifyWithRecoveryKey(session: Session, input: string) {
  const credential = input.trim();
  if (!credential) throw new Error("Enter your recovery key.");
  const { client } = session;
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Encryption isn't available in this browser.");
  const tuple = await client.secretStorage.getKey();
  if (!tuple) throw new Error("This account has no recovery key set up.");
  const [keyId, info] = tuple;

  const candidates: (() => Promise<Uint8Array<ArrayBuffer>>)[] = [];
  const asKey = async () => decodeRecoveryKey(credential);
  const asPhrase = async () => {
    if (!info.passphrase) throw new Error("no passphrase");
    return deriveRecoveryKeyFromPassphrase(credential, info.passphrase.salt, info.passphrase.iterations);
  };
  candidates.push(...(looksLikeRecoveryKey(credential) ? [asKey, asPhrase] : [asPhrase, asKey]));

  let key: Uint8Array<ArrayBuffer> | undefined;
  for (const candidate of candidates) {
    try {
      const attempt = await candidate();
      if (await client.secretStorage.checkKey(attempt, info as never)) {
        key = attempt;
        break;
      }
    } catch {
      // try the other kind
    }
  }
  if (!key) throw new Error("That recovery key didn't work. Check it and try again.");

  enteredKey = { keyId, key };
  try {
    // With the cross-signing keys readable from secret storage, this loads them and signs this device.
    await crypto.bootstrapCrossSigning({});
    const status = await crypto.getDeviceVerificationStatus(session.userId, session.deviceId);
    if (!status?.crossSigningVerified) {
      throw new Error("Your recovery key worked, but this device couldn't be signed. Try again.");
    }
    await waitForKeyBackup(session, 5000);
  } finally {
    enteredKey = undefined;
  }
}

export type Emoji = [string, string];

export interface DeviceVerificationCallbacks {
  /** The emoji to compare; call `confirm(true)` if they match the other device's. */
  onEmoji(emoji: Emoji[], confirm: (match: boolean) => Promise<void>): void;
  onCancelled(code: string | undefined, byUs: boolean): void;
  onDone(): void;
}

export interface RunningDeviceVerification {
  readonly finished: boolean;
  abort(): Promise<void>;
}

/** Asks the user's other devices to verify this one with emoji. */
export async function startDeviceVerification(
  session: Session,
  callbacks: DeviceVerificationCallbacks
): Promise<RunningDeviceVerification> {
  const crypto = session.client.getCrypto();
  if (!crypto) throw new Error("Encryption isn't available in this browser.");
  const request: VerificationRequest = await crypto.requestOwnUserVerification();
  let finished = false;
  let verifier: Verifier | undefined;
  let starting = false;

  const finish = (report: () => void) => {
    if (finished) return;
    finished = true;
    request.off(VerificationRequestEvent.Change, onChange);
    report();
  };

  const run = (v: Verifier) => {
    if (verifier) return;
    verifier = v;
    const showSas = (sas: ShowSasCallbacks) => {
      const emoji = (sas.sas.emoji ?? []) as Emoji[];
      callbacks.onEmoji(emoji, async (match) => {
        if (match) await sas.confirm();
        else sas.mismatch();
      });
    };
    v.on(VerifierEvent.ShowSas, showSas);
    const existing = v.getShowSasCallbacks();
    if (existing) showSas(existing);
    v.verify()
      .then(() => finish(() => callbacks.onDone()))
      .catch(() => {
        finish(() =>
          callbacks.onCancelled(
            request.cancellationCode ?? undefined,
            request.cancellingUserId === session.userId && starting
          )
        );
      });
  };

  const onChange = () => {
    if (finished) return;
    const phase = request.phase;
    if (phase === VerificationPhase.Ready && !verifier && !starting) {
      // The other device accepted; go straight to emoji, as Element does.
      starting = true;
      request
        .startVerification("m.sas.v1")
        .then(run)
        .catch(() => undefined);
    } else if (phase === VerificationPhase.Started && request.verifier) {
      run(request.verifier);
    } else if (phase === VerificationPhase.Cancelled) {
      finish(() => callbacks.onCancelled(request.cancellationCode ?? undefined, false));
    } else if (phase === VerificationPhase.Done) {
      finish(() => callbacks.onDone());
    }
  };
  request.on(VerificationRequestEvent.Change, onChange);
  onChange();

  return {
    get finished() {
      return finished;
    },
    abort: async () => {
      if (finished) return;
      finished = true;
      request.off(VerificationRequestEvent.Change, onChange);
      await request.cancel().catch(() => undefined);
    },
  };
}

export function skippedVerificationKey(session: Session) {
  return `buzzar_verification_skipped:${session.userId}:${session.deviceId}`;
}
