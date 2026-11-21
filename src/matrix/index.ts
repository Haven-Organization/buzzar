/**
 * Buzzar's Matrix layer (plan 02): everything the app uses to talk to Matrix, built on matrix-js-sdk.
 * UI and engine code import from here, never from the SDK's own modules (except inside this folder).
 */
export * from "./observable";
export * from "./platform";
export * from "./room";
export * from "./session";
export * from "./calls";
export * from "./client";
export * from "./oidc";
export * from "./crypto";

/** A transaction ID for sending events through `hsApi.send` / `redact`. */
export function makeTxnId(): string {
  return `t${Date.now()}${Math.floor(Math.random() * 1e9)}`;
}
