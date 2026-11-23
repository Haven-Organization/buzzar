/**
 * Buzzar: how a world's call is carried. Two methods exist side by side:
 *
 * - "mesh": MSC3401 group calls, every player connected to every other (voice and the game's data channel ride
 *   peer-to-peer WebRTC, through the homeserver's TURN relay when a direct path fails). What every Buzzar build and
 *   the older Hydrogen-based one speak.
 * - "livekit": a MatrixRTC (MSC4143) session whose media and data go through a LiveKit server (MSC4195). Scales to
 *   far more players; only this and later builds speak it.
 *
 * Players only see and hear the others in the same call, so a world names the method to use for new calls (its
 * `software.haven.world.call` state event), and someone arriving while a call of another method is already open is
 * asked which to join (CallMethodDialog). With Developer Mode on, Settings → Developer can override the method used to
 * start calls.
 */

export type CallMethod = "mesh" | "livekit";

export const CALL_METHODS: CallMethod[] = ["mesh", "livekit"];

/** World room state (state key ""): `{ "recommended_method": "mesh" | "livekit" }`. */
export const WORLD_CALL_EVENT = "software.haven.world.call";

/** Used by worlds that don't name one: the method every client can join. */
export const DEFAULT_CALL_METHOD: CallMethod = "mesh";

/** Developer override for starting calls (localStorage, JSON like useLocalStorage): "recommended" or a method. */
export const CALL_METHOD_OVERRIDE_KEY = "buzzar.callMethodOverride";

export type CallMethodOverride = "recommended" | CallMethod;

export const CALL_METHOD_LABEL: Record<CallMethod, string> = {
  mesh: "Peer-to-peer (mesh)",
  livekit: "LiveKit server",
};

export function isCallMethod(value: unknown): value is CallMethod {
  return value === "mesh" || value === "livekit";
}

/** The recommended method from a world's `software.haven.world.call` content (or the default). */
export function recommendedCallMethod(content: unknown): CallMethod {
  const method = (content as { recommended_method?: unknown } | undefined)?.recommended_method;
  return isCallMethod(method) ? method : DEFAULT_CALL_METHOD;
}

/** The developer override, if Developer Mode is on and one is chosen. */
export function callMethodOverride(): CallMethod | undefined {
  try {
    const developerMode = JSON.parse(localStorage.getItem("buzzar.developerMode") ?? "false");
    if (developerMode !== true) return undefined;
    const value = JSON.parse(localStorage.getItem(CALL_METHOD_OVERRIDE_KEY) ?? '"recommended"');
    return isCallMethod(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Who is in each open call of a world (user IDs, one entry per device, without us). */
export type OpenWorldCalls = Record<CallMethod, string[]>;

export type CallMethodDecision =
  | { kind: "join"; method: CallMethod }
  | {
      kind: "ask";
      /** The method new calls should use (what the world recommends, or the developer override). */
      preferred: CallMethod;
      /** The choices, the open calls first (most players first), then the preferred method if it has no call. */
      options: { method: CallMethod; players: string[] }[];
    };

/**
 * What to do on entering a world:
 * - nobody in any call: start the preferred method's call;
 * - the only open call is the preferred method's: join it;
 * - any open call of another method: ask (it lists every open call, and the preferred method).
 */
export function decideCallMethod(preferred: CallMethod, open: OpenWorldCalls): CallMethodDecision {
  const others = CALL_METHODS.filter((method) => method !== preferred && open[method].length > 0);
  if (others.length === 0) return { kind: "join", method: preferred };
  const options = CALL_METHODS.filter((method) => open[method].length > 0)
    .map((method) => ({ method, players: open[method] }))
    .sort((a, b) => b.players.length - a.players.length);
  if (open[preferred].length === 0) options.push({ method: preferred, players: [] });
  return { kind: "ask", preferred, options };
}

/**
 * Asks the player which call to join (set by the UI: CallMethodDialog). Resolves with the method, or undefined if
 * they cancelled (the world isn't entered).
 */
export type CallMethodChooser = (
  world: { id: string; name: string },
  decision: Extract<CallMethodDecision, { kind: "ask" }>
) => Promise<CallMethod | undefined>;

let chooser: CallMethodChooser | undefined;

export function setCallMethodChooser(value: CallMethodChooser | undefined) {
  chooser = value;
}

export function getCallMethodChooser(): CallMethodChooser | undefined {
  return chooser;
}
