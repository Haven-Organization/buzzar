/**
 * Buzzar: the app's own "are you sure?" dialog, instead of the browser's window.confirm (an unstyled system box that
 * doesn't match the app). Call `confirmDialog(...)` from anywhere; it resolves true when the person confirms.
 * `ConfirmDialogHost`, mounted once in the session, shows the dialogs one at a time and pauses the player meanwhile.
 */
import { ReactNode, useEffect, useState } from "react";

import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { useDisableInput } from "../../../hooks/useDisableInput";
import { AlertDialog } from "../../session/dialogs/AlertDialog";

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  /** The confirm button's label (e.g. "Leave"). Default "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for things that lose something (leave, delete, log out). */
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let queue: Pending[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Asks the person to confirm something; resolves true if they do, false if they cancel or close it. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (document.pointerLockElement) document.exitPointerLock();
  return new Promise((resolve) => {
    queue = [...queue, { ...options, resolve }];
    emit();
  });
}

function settle(ok: boolean) {
  const [current, ...rest] = queue;
  if (!current) return;
  queue = rest;
  emit();
  current.resolve(ok);
}

export function ConfirmDialogHost() {
  const [current, setCurrent] = useState<Pending | undefined>(queue[0]);
  useEffect(() => {
    const listener = () => setCurrent(queue[0]);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useDisableInput(!!current);
  if (!current) return null;

  return (
    <AlertDialog
      open
      title={current.title}
      requestClose={() => settle(false)}
      content={
        typeof current.message === "string" ? (
          <Text variant="b2" style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
            {current.message}
          </Text>
        ) : (
          current.message
        )
      }
      buttons={
        <>
          <Button variant={current.danger ? "danger" : "primary"} onClick={() => settle(true)}>
            {current.confirmLabel ?? "OK"}
          </Button>
          <Button variant="secondary" fill="outline" onClick={() => settle(false)}>
            {current.cancelLabel ?? "Cancel"}
          </Button>
        </>
      }
    />
  );
}
