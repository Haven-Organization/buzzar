/**
 * Buzzar: answers world scripts' requests to use the visitor's Matrix account (see engine/matrix/scriptConsent.main).
 * The dialog is client UI that scripts can't draw over or click.
 *
 * - Reading the live world chat: asked once per world and script version, remembered in account data
 *   (software.haven.world.script_grants) if the visitor ticks "Remember", revocable in Settings.
 * - Posting a message: asked every time, showing exactly what would be sent.
 */
import { useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";

import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { Checkbox } from "../../../atoms/checkbox/Checkbox";
import { AlertDialog } from "../dialogs/AlertDialog";
import { useMatrix } from "../../../hooks/useMatrix";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { useDisableInput } from "../../../hooks/useDisableInput";
import { getSessionAuth } from "../../../utils/avatarMatrix";
import { fetchScriptGrants, saveScriptGrants } from "../../../utils/scriptSettings";
import { ScriptConsentRequest, setScriptConsentHandler } from "../../../../engine/matrix/scriptConsent.main";
import { registerMessageHandler } from "../../../../engine/module/module.common";
import { ScriptFailedMessage, ThirdRoomMessageType } from "../../../../plugins/thirdroom/thirdroom.common";
import { makeWorldNotice, worldNoticeAtom } from "../../../state/worldNotice";

interface Pending {
  request: ScriptConsentRequest;
  resolve: (granted: boolean) => void;
}

export function ScriptConsent() {
  const { session, platform, client } = useMatrix(true);
  const mainThread = useMainThreadContext();
  const setWorldNotice = useSetAtom(worldNoticeAtom);
  const [queue, setQueue] = useState<Pending[]>([]);
  const [remember, setRemember] = useState(true);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const current = queue[0];

  useDisableInput(!!current);

  useEffect(() => {
    const ask = (request: ScriptConsentRequest) =>
      new Promise<boolean>((resolve) => {
        if (document.pointerLockElement) document.exitPointerLock();
        setQueue((q) => [...q, { request, resolve }]);
      });

    return setScriptConsentHandler(async (request) => {
      if (request.kind === "receive") {
        // A remembered answer for this exact script?
        try {
          const auth = await getSessionAuth(platform, client.sessionId);
          if (auth) {
            const grant = (await fetchScriptGrants(auth, session.userId))[request.roomId];
            if (grant && grant.script === request.scriptUrl) return grant.receive;
          }
        } catch (error) {
          console.warn(error);
        }
      }
      return ask(request);
    });
  }, [platform, client, session]);

  // Unanswered requests are refused if the dialog goes away (leaving the world).
  useEffect(
    () => () => {
      for (const pending of queueRef.current) pending.resolve(false);
    },
    []
  );

  // A world script that failed or crashed: say so (the world itself keeps working).
  useEffect(
    () =>
      registerMessageHandler(mainThread, ThirdRoomMessageType.ScriptFailed, (_ctx, message: ScriptFailedMessage) => {
        setWorldNotice(
          makeWorldNotice(`This world's script stopped working (${message.error}). The world runs without it.`)
        );
      }),
    [mainThread, setWorldNotice]
  );

  const answer = async (granted: boolean) => {
    if (!current) return;
    const { request } = current;
    setQueue((q) => q.slice(1));
    current.resolve(granted);
    if (request.kind === "receive" && remember) {
      try {
        const auth = await getSessionAuth(platform, client.sessionId);
        if (!auth) return;
        const grants = await fetchScriptGrants(auth, session.userId);
        grants[request.roomId] = { script: request.scriptUrl, receive: granted, granted_ts: Date.now() };
        await saveScriptGrants(auth, session.userId, grants);
      } catch (error) {
        console.warn("Couldn't remember the script permission", error);
      }
    }
  };

  if (!current) return null;
  const { request } = current;
  const worldName = session.rooms.get(request.roomId)?.name || "This world";

  if (request.kind === "receive") {
    return (
      <AlertDialog
        open
        title="World script permission"
        requestClose={() => answer(false)}
        content={
          <div className="flex flex-column gap-sm">
            <Text variant="b2">
              <b>{worldName}</b>'s script wants to <b>read this world's chat</b> while you're here, for example to show
              messages on an in-world screen.
            </Text>
            <Text variant="b3" color="surface-low">
              It only sees new messages, not earlier ones, and it can't post anything as you without asking you each
              time.
            </Text>
            <label className="flex items-center gap-xs">
              <Checkbox checked={remember} onCheckedChange={setRemember} />
              <Text variant="b3">Remember my answer for this world (until its script changes)</Text>
            </label>
          </div>
        }
        buttons={
          <div className="flex gap-xs justify-end">
            <Button fill="outline" onClick={() => answer(false)}>
              Don't Allow
            </Button>
            <Button onClick={() => answer(true)}>Allow</Button>
          </div>
        }
      />
    );
  }

  return (
    <AlertDialog
      open
      title="Post as you?"
      requestClose={() => answer(false)}
      content={
        <div className="flex flex-column gap-sm">
          <Text variant="b2">
            <b>{worldName}</b>'s script wants to post this {request.msgtype === "m.emote" ? "action" : "message"} in the
            world chat as you:
          </Text>
          <div
            style={{
              padding: "var(--sp-sm)",
              borderRadius: "var(--br-sm)",
              background: "var(--bg-surface-low)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 240,
              overflow: "auto",
            }}
          >
            <Text variant="b2">{request.body}</Text>
          </div>
          <Text variant="b3" color="surface-low">
            It will be marked as sent by the world's script.
          </Text>
        </div>
      }
      buttons={
        <div className="flex gap-xs justify-end">
          <Button fill="outline" onClick={() => answer(false)}>
            Don't Send
          </Button>
          <Button onClick={() => answer(true)}>Send</Button>
        </div>
      }
    />
  );
}
