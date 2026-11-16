/**
 * Buzzar: world-script settings: run scripts at all, allow web-hosted scripts, and the worlds you've let read
 * the chat (revocable).
 */
import { useCallback, useEffect, useState } from "react";

import { SettingTile } from "../../components/setting-tile/SettingTile";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { Button } from "../../../atoms/button/Button";
import { Switch } from "../../../atoms/button/Switch";
import { useLocalStorage } from "../../../hooks/useLocalStorage";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { getSessionAuth } from "../../../utils/avatarMatrix";
import {
  fetchScriptGrants,
  RUN_SCRIPTS_KEY,
  saveScriptGrants,
  ScriptGrants,
  WEB_SCRIPTS_KEY,
} from "../../../utils/scriptSettings";

export function WorldScriptSettings() {
  const { session, platform, client } = useHydrogen(true);
  const [runScripts, setRunScripts] = useLocalStorage(RUN_SCRIPTS_KEY, true);
  const [webScripts, setWebScripts] = useLocalStorage(WEB_SCRIPTS_KEY, false);
  const [grants, setGrants] = useState<ScriptGrants>();
  const [error, setError] = useState<string>();

  const getAuth = useCallback(async () => {
    const auth = await getSessionAuth(platform, client.sessionId);
    if (!auth) throw new Error("Not signed in");
    return auth;
  }, [platform, client]);

  useEffect(() => {
    getAuth()
      .then((auth) => fetchScriptGrants(auth, session.userId))
      .then(setGrants)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [getAuth, session]);

  const revoke = async (roomId: string) => {
    setError(undefined);
    try {
      const auth = await getAuth();
      const next = { ...(await fetchScriptGrants(auth, session.userId)) };
      delete next[roomId];
      await saveScriptGrants(auth, session.userId, next);
      setGrants(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remembered = Object.entries(grants ?? {});

  return (
    <>
      <div className="flex gap-lg">
        <SettingTile className="grow basis-0" label={<Label>Run World Scripts</Label>}>
          <Switch checked={runScripts} onCheckedChange={setRunScripts} />
          <Text variant="b3" color="surface-low">
            Scripts make worlds interactive. Off: worlds load without them (some may not work fully).
          </Text>
        </SettingTile>
        <SettingTile className="grow basis-0" label={<Label>Allow Scripts From Web Addresses</Label>}>
          <Switch checked={webScripts} onCheckedChange={setWebScripts} />
          <Text variant="b3" color="surface-low">
            Off by default: loading a script from a website shows that site your IP address. Scripts stored on
            Matrix always load.
          </Text>
        </SettingTile>
      </div>
      <div className="flex gap-lg">
        <SettingTile className="grow basis-0" label={<Label>Worlds You've Answered About Reading Chat</Label>}>
          {remembered.length === 0 ? (
            <Text variant="b3" color="surface-low">
              {grants ? "None. World scripts ask before reading the world chat." : "Loading…"}
            </Text>
          ) : (
            <div className="flex flex-column gap-xs">
              {remembered.map(([roomId, grant]) => (
                <div key={roomId} className="flex items-center gap-xs">
                  <Text className="grow truncate" variant="b2">
                    {session.rooms.get(roomId)?.name || roomId}
                  </Text>
                  <Text variant="b3" color="surface-low">
                    {grant.receive ? "Allowed" : "Not allowed"}
                  </Text>
                  <Button size="sm" fill="outline" onClick={() => revoke(roomId)}>
                    Forget
                  </Button>
                </div>
              ))}
            </div>
          )}
          {error && (
            <Text variant="b3" color="danger">
              {error}
            </Text>
          )}
          <Text variant="b3" color="surface-low">
            Scripts can never post as you without asking each time.
          </Text>
        </SettingTile>
      </div>
    </>
  );
}
