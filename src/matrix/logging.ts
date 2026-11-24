/**
 * Buzzar: quieter Matrix logs. matrix-js-sdk logs at DEBUG (every request, every sync step) and the encryption
 * library (Rust, matrix-sdk-crypto-wasm) at INFO/WARN (each batch of backup keys, every duplicate key). All of it ran
 * on the page's main thread while a world loaded: printing to the console is slow, and it made looking around stutter
 * for the first seconds. Warnings and errors from matrix-js-sdk still show; the encryption library only reports
 * errors.
 *
 * localStorage "buzzar.verboseLogs" = "1" keeps everything (for debugging).
 *
 * loglevel and matrix-sdk-crypto-wasm come with matrix-js-sdk (imported here as the same copies it uses).
 */
import loglevel from "loglevel";
import { LoggerLevel, Tracing } from "@matrix-org/matrix-sdk-crypto-wasm";

const QUIET = new Set(["trace", "debug", "info", "log"]);
const NOISY_ERROR = "Got room state event for unknown room";

function verbose(): boolean {
  try {
    return localStorage.getItem("buzzar.verboseLogs") === "1";
  } catch {
    return false;
  }
}

type Factory = typeof loglevel.methodFactory;

function quieten(target: { methodFactory: Factory; rebuild?: () => void; getLevel(): number; setLevel: Function }) {
  const original = target.methodFactory;
  if ((original as { buzzarQuiet?: boolean }).buzzarQuiet) return;
  const quiet: Factory = (methodName, level, name) => {
    if (QUIET.has(methodName as string)) return () => undefined;
    const method = original(methodName, level, name);
    // Hundreds of these during a sync, all harmless (state for rooms sliding sync hasn't loaded yet).
    return (...args: unknown[]) => {
      if (args.some((arg) => typeof arg === "string" && arg.includes(NOISY_ERROR))) return;
      method(...args);
    };
  };
  (quiet as { buzzarQuiet?: boolean }).buzzarQuiet = true;
  target.methodFactory = quiet;
  // Apply to the methods already built.
  if (target.rebuild) target.rebuild();
  else target.setLevel(target.getLevel(), false);
}

/** matrix-js-sdk's loggers (existing ones, and new ones, which copy their parent's factory). Call before the client starts. */
export function quietMatrixLogs() {
  if (verbose()) return;
  quieten(loglevel as never);
  for (const logger of Object.values(loglevel.getLoggers())) quieten(logger as never);
}

/** The encryption library: errors only. Call once it's loaded (after initRustCrypto). */
export function quietCryptoLogs() {
  if (verbose()) return;
  try {
    if (Tracing.isAvailable()) new Tracing(LoggerLevel.Error).turnOn();
  } catch (e) {
    console.warn("Couldn't set the encryption library's log level", e);
  }
}
