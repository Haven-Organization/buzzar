/**
 * Buzzar: consent for what world scripts may do with the visitor's Matrix account.
 *
 * World scripts get no Matrix access by default. The engine asks the UI (which shows a client-owned dialog the
 * script can't draw over) and waits for the answer:
 *
 * - "receive": read this world's chat as it happens (no history). Asked once per world and script version
 *   (script_url; mxc URIs are immutable, so a new script means a new URL and a new question). The UI may answer
 *   from a remembered grant.
 * - "send": post one specific message as the visitor. Asked every time, showing the text; never remembered.
 *
 * Everything else (state events, other event types, reading history, other rooms) is never granted.
 */

export type ScriptConsentRequest =
  | { kind: "receive"; roomId: string; scriptUrl: string }
  | { kind: "send"; roomId: string; scriptUrl: string; msgtype: string; body: string };

export type ScriptConsentHandler = (request: ScriptConsentRequest) => Promise<boolean>;

let handler: ScriptConsentHandler | undefined;

/** The UI registers the function that answers consent requests (returns a disposer). */
export function setScriptConsentHandler(next: ScriptConsentHandler) {
  handler = next;
  return () => {
    if (handler === next) handler = undefined;
  };
}

/** Asks the visitor. With no UI listening, the answer is no. */
export async function requestScriptConsent(request: ScriptConsentRequest): Promise<boolean> {
  if (!handler) return false;
  try {
    return await handler(request);
  } catch (error) {
    console.error("Script consent failed", error);
    return false;
  }
}

/** Marker added to every event a script sends, so other clients and moderators can tell. */
export const VIA_SCRIPT_KEY = "software.haven.world.via_script";

/** Message types a script may ask to send (each one confirmed by the visitor). */
export const SCRIPT_SENDABLE_MSGTYPES = new Set(["m.text", "m.emote", "m.notice"]);

/** Longest message a script may propose (characters). */
export const SCRIPT_MESSAGE_MAX_LENGTH = 2000;

/** After this many declined send requests in one visit, further ones are refused without asking. */
export const SCRIPT_SEND_DECLINE_LIMIT = 3;
