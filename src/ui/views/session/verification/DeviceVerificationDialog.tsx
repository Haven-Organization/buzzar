/**
 * Buzzar: "Confirm your identity" after sign-in, modelled on Element. It steers toward verifying with another
 * device (emoji comparison), offers the recovery key instead, and lets people skip after a warning.
 * Only shown when the account has cross-signing and this device isn't signed yet.
 */
import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useAtom } from "jotai";

import { Dialog } from "../../../atoms/dialog/Dialog";
import { Text } from "../../../atoms/text/Text";
import { Button } from "../../../atoms/button/Button";
import { Input } from "../../../atoms/input/Input";
import { Dots } from "../../../atoms/loading/Dots";
import { useMatrix } from "../../../hooks/useMatrix";
import { deviceVerificationAtom } from "../../../state/deviceVerification";
import {
  getDeviceVerificationStatus,
  hasKeyBackup,
  RunningDeviceVerification,
  skippedVerificationKey,
  startDeviceVerification as startVerification,
  verifyWithRecoveryKey,
} from "../../../utils/deviceVerification";
import "./DeviceVerificationDialog.css";

/** [emoji, name] */
type Emoji = [string, string];

type Stage =
  | { kind: "choose" }
  | { kind: "skip-confirm" }
  | { kind: "recovery"; busy?: boolean; error?: string }
  | { kind: "waiting" }
  | { kind: "emoji"; emoji: Emoji[]; confirm: (match: boolean) => Promise<void>; answered?: boolean }
  | { kind: "done" }
  | { kind: "cancelled"; message: string };

interface RunningVerification {
  sas?: RunningDeviceVerification;
}

function cancelMessage(code: string | undefined, byUs: boolean) {
  switch (code) {
    case "m.timeout":
      return "Your other device didn't respond in time.";
    case "m.mismatched_sas":
    case "m.key_mismatch":
      return "The emoji didn't match, so this device wasn't verified. If you didn't start this, someone may be trying to impersonate you.";
    case "m.unknown_method":
    case "m.unexpected_message":
      return "Your other device couldn't verify this way. Try your recovery key instead.";
    default:
      return byUs ? "You cancelled the verification." : "The verification was cancelled on your other device.";
  }
}

function ShieldIcon() {
  return (
    <svg className="DeviceVerification__icon" viewBox="0 0 24 24" width="48" height="48" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm0 2.2 6 2.2V11c0 4-2.6 7.8-6 8.9-3.4-1.1-6-4.9-6-8.9V6.4l6-2.2Zm-1 10.6-2.6-2.6L7 13.6l4 4 6-6-1.4-1.4-4.6 4.6Z"
      />
    </svg>
  );
}

function DevicesIcon() {
  return (
    <svg className="DeviceVerification__icon" viewBox="0 0 24 24" width="48" height="48" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 6h14V4H4a2 2 0 0 0-2 2v11H0v3h12v-3H4V6Zm19 2h-7a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1Zm-1 9h-5v-7h5v7Z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="DeviceVerification__icon DeviceVerification__icon--success"
      viewBox="0 0 24 24"
      width="48"
      height="48"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.5 14.5-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7Z"
      />
    </svg>
  );
}

function Screen({
  icon,
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="DeviceVerification flex flex-column items-center gap-lg">
      {icon}
      <div className="flex flex-column items-center gap-sm">
        <Text variant="h2" weight="bold" className="DeviceVerification__title">
          {title}
        </Text>
        {children}
      </div>
      <div className="DeviceVerification__actions flex flex-column gap-sm">{actions}</div>
    </div>
  );
}

export function DeviceVerificationDialog() {
  const { session } = useMatrix(true);
  const [state, setState] = useAtom(deviceVerificationAtom);
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [recoveryKey, setRecoveryKey] = useState("");
  // Whether this device can read older encrypted messages. Verifying from another device normally hands the key
  // backup over; if it didn't arrive, the "Device verified" screen offers the recovery key.
  const [noKeyBackup, setNoKeyBackup] = useState(false);
  const refreshKeyBackup = useCallback(() => {
    hasKeyBackup(session).then((has) => setNoKeyBackup(!has));
  }, [session]);
  const running = useRef<RunningVerification>();

  // Check once per session whether this device still needs verifying.
  useEffect(() => {
    let cancelled = false;
    getDeviceVerificationStatus(session).then((status) => {
      if (cancelled) return;
      let skipped = false;
      try {
        skipped = localStorage.getItem(skippedVerificationKey(session)) === "1";
      } catch {
        // storage unavailable
      }
      setState({ status, open: status === "unverified" && !skipped });
    });
    return () => {
      cancelled = true;
    };
  }, [session, setState]);

  const stopVerification = useCallback(() => {
    const current = running.current;
    running.current = undefined;
    if (!current) return;
    if (current.sas && !current.sas.finished) current.sas.abort().catch(() => undefined);
  }, []);

  useEffect(() => stopVerification, [stopVerification]);

  const close = useCallback(() => {
    stopVerification();
    setState((s) => ({ ...s, open: false }));
    setStage({ kind: "choose" });
    setRecoveryKey("");
  }, [stopVerification, setState]);

  const markVerified = useCallback(() => {
    setStage({ kind: "done" });
    refreshKeyBackup();
    // The other device uploads its signature for us; re-read the status once it has.
    setTimeout(() => {
      getDeviceVerificationStatus(session).then((status) => setState((s) => ({ ...s, status })));
    }, 2000);
  }, [session, setState, refreshKeyBackup]);

  const startDeviceVerification = useCallback(() => {
    stopVerification();
    setStage({ kind: "waiting" });
    const current: RunningVerification = {};
    running.current = current;
    startVerification(session, {
      onEmoji: (emoji, confirm) => {
        if (running.current !== current) return;
        setStage({ kind: "emoji", emoji, confirm });
      },
      onCancelled: (code, byUs) => {
        if (running.current !== current) return;
        setStage({ kind: "cancelled", message: cancelMessage(code, byUs) });
      },
      onDone: () => {
        if (running.current !== current) return;
        markVerified();
      },
    })
      .then((sas) => {
        current.sas = sas;
        if (running.current !== current) sas.abort().catch(() => undefined);
      })
      .catch((error: unknown) => {
        if (running.current !== current) return;
        setStage({
          kind: "cancelled",
          message: error instanceof Error ? error.message : "Couldn't start verification.",
        });
      });
  }, [session, stopVerification, markVerified]);

  const submitRecoveryKey = async (event: FormEvent) => {
    event.preventDefault();
    setStage({ kind: "recovery", busy: true });
    try {
      await verifyWithRecoveryKey(session, recoveryKey);
      setRecoveryKey("");
      markVerified();
    } catch (error) {
      setStage({ kind: "recovery", error: error instanceof Error ? error.message : String(error) });
    }
  };

  const skip = () => {
    try {
      localStorage.setItem(skippedVerificationKey(session), "1");
    } catch {
      // not remembered; it will ask again next time
    }
    close();
  };

  const backToChoices = () => {
    stopVerification();
    setStage({ kind: "choose" });
  };

  let content: ReactNode;
  switch (stage.kind) {
    case "choose":
      content = (
        <Screen
          icon={<ShieldIcon />}
          title="Confirm your identity"
          actions={
            <>
              <Button size="lg" onClick={startDeviceVerification}>
                Use another device
              </Button>
              <Button size="lg" fill="outline" onClick={() => setStage({ kind: "recovery" })}>
                Use recovery key
              </Button>
              <Button size="md" fill="none" onClick={() => setStage({ kind: "skip-confirm" })}>
                Can&apos;t confirm?
              </Button>
            </>
          }
        >
          <Text variant="b2" color="surface-low" className="DeviceVerification__body">
            Verify this device to set up secure messaging, so you can read your encrypted messages here and others know
            it&apos;s really you.
          </Text>
        </Screen>
      );
      break;

    case "skip-confirm":
      content = (
        <Screen
          icon={<ShieldIcon />}
          title="Skip verification for now?"
          actions={
            <>
              <Button size="lg" onClick={() => setStage({ kind: "choose" })}>
                Verify
              </Button>
              <Button size="lg" variant="danger" fill="outline" onClick={skip}>
                Skip
              </Button>
            </>
          }
        >
          <Text variant="b2" color="surface-low" className="DeviceVerification__body">
            Without verifying, you won&apos;t have access to all your encrypted messages on this device, and you may
            appear as untrusted to others. You can verify later from the menu under your profile picture.
          </Text>
        </Screen>
      );
      break;

    case "recovery":
      content = (
        <form className="DeviceVerification__form" onSubmit={submitRecoveryKey}>
          <Screen
            icon={<ShieldIcon />}
            title="Enter your recovery key"
            actions={
              <>
                <Button size="lg" type="submit" disabled={stage.busy || !recoveryKey.trim()}>
                  {stage.busy ? <Dots color="on-primary" /> : "Continue"}
                </Button>
                <Button size="lg" fill="outline" onClick={backToChoices} disabled={stage.busy}>
                  Back
                </Button>
              </>
            }
          >
            <Text variant="b2" color="surface-low" className="DeviceVerification__body">
              Use the recovery key you saved when you set up secure messaging. A security phrase works too, if you set
              one.
            </Text>
            <Input
              className="DeviceVerification__key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              placeholder="EsT1 2345 …"
              value={recoveryKey}
              disabled={stage.busy}
              state={stage.error ? "error" : undefined}
              onChange={(e) => setRecoveryKey(e.target.value)}
            />
            {stage.error && (
              <Text variant="b3" color="danger">
                {stage.error}
              </Text>
            )}
          </Screen>
        </form>
      );
      break;

    case "waiting":
      content = (
        <Screen
          icon={<DevicesIcon />}
          title="Verify from another device"
          actions={
            <Button size="lg" fill="outline" onClick={backToChoices}>
              Cancel
            </Button>
          }
        >
          <Text variant="b2" color="surface-low" className="DeviceVerification__body">
            Open Element, or another Matrix app where you&apos;re signed in, and accept the verification request.
          </Text>
          <Dots />
        </Screen>
      );
      break;

    case "emoji":
      content = (
        <Screen
          icon={<DevicesIcon />}
          title="Compare emoji"
          actions={
            stage.answered ? (
              <div className="flex items-center justify-center gap-sm">
                <Dots />
                <Text variant="b2" color="surface-low">
                  Waiting for your other device to confirm…
                </Text>
              </div>
            ) : (
              <div className="DeviceVerification__row flex gap-sm">
                <Button
                  size="lg"
                  variant="danger"
                  fill="outline"
                  onClick={() => {
                    setStage({ ...stage, answered: true });
                    stage.confirm(false);
                  }}
                >
                  They don&apos;t match
                </Button>
                <Button
                  size="lg"
                  onClick={() => {
                    setStage({ ...stage, answered: true });
                    stage.confirm(true);
                  }}
                >
                  They match
                </Button>
              </div>
            )
          }
        >
          <Text variant="b2" color="surface-low" className="DeviceVerification__body">
            Confirm that the emoji below are shown on both devices, in the same order.
          </Text>
          <ol className="DeviceVerification__emoji">
            {stage.emoji.map(([symbol, name], i) => (
              <li key={i}>
                <span className="DeviceVerification__emojiSymbol" aria-hidden="true">
                  {symbol}
                </span>
                <Text variant="b3">{name.charAt(0).toUpperCase() + name.slice(1)}</Text>
              </li>
            ))}
          </ol>
        </Screen>
      );
      break;

    case "done":
      content = (
        <Screen
          icon={<CheckIcon />}
          title="Device verified"
          actions={
            noKeyBackup ? (
              <>
                <Button size="lg" onClick={() => setStage({ kind: "recovery" })}>
                  Enter recovery key
                </Button>
                <Button size="lg" fill="outline" onClick={close}>
                  Not now
                </Button>
              </>
            ) : (
              <Button size="lg" onClick={close}>
                Done
              </Button>
            )
          }
        >
          <Text variant="b2" color="surface-low" className="DeviceVerification__body">
            This device is now verified. Other people will see it as trusted, and new encrypted messages will reach it.
          </Text>
          {noKeyBackup && (
            <Text variant="b2" color="surface-low" className="DeviceVerification__body">
              To read your older encrypted messages here too, enter your recovery key once. (Verifying with another
              device doesn't pass on your message backup yet.)
            </Text>
          )}
        </Screen>
      );
      break;

    case "cancelled":
      content = (
        <Screen
          icon={<ShieldIcon />}
          title="Verification didn't finish"
          actions={
            <>
              <Button size="lg" onClick={startDeviceVerification}>
                Try again
              </Button>
              <Button size="lg" fill="outline" onClick={backToChoices}>
                Back
              </Button>
            </>
          }
        >
          <Text variant="b2" color="surface-low" className="DeviceVerification__body">
            {stage.message}
          </Text>
        </Screen>
      );
      break;
  }

  return (
    <Dialog
      className="DeviceVerificationDialog"
      open={state.open}
      // Escape and outside clicks don't close it: leaving goes through "Can't confirm?" and its warning.
      onOpenChange={() => undefined}
    >
      {content}
    </Dialog>
  );
}
