import { useEffect, useState } from "react";

import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { Switch } from "../../../atoms/button/Switch";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { getSessionAuth } from "../../../utils/avatarMatrix";
import { getSpaceAccountData, setSpaceAccountData, SpaceAccountData } from "../../../utils/buzzarSpace";

/**
 * Buzzar: turn the personal "Buzzar" space on or off. Stored in account data, so it applies on every device.
 * Turning it off leaves the space as it is; the user can then leave it from any Matrix client.
 */
export function BuzzarSpaceSetting() {
  const { session, platform, client } = useHydrogen(true);
  const [data, setData] = useState<SpaceAccountData>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) return;
      const loaded = await getSpaceAccountData(auth, session.userId).catch(() => undefined);
      if (!cancelled) setData(loaded ?? {});
    })();
    return () => {
      cancelled = true;
    };
  }, [session, platform, client]);

  const enabled = data ? !data.disabled : true;

  const setEnabled = async (on: boolean) => {
    setSaving(true);
    setError(undefined);
    try {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      // Re-read so a space created meanwhile (on another device) isn't forgotten.
      const current = (await getSpaceAccountData(auth, session.userId)) ?? {};
      const next: SpaceAccountData = { ...current };
      if (on) delete next.disabled;
      else next.disabled = true;
      await setSpaceAccountData(auth, session.userId, next);
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingTile className="grow basis-0" label={<Label>Keep My Worlds in a Buzzar Space</Label>}>
      <Switch checked={enabled} disabled={!data || saving} onCheckedChange={setEnabled} />
      <Text variant="b3" color={error ? "danger" : "surface-low"}>
        {error ??
          (enabled
            ? 'Buzzar keeps a private "Buzzar" space listing the worlds you create and join, so other Matrix apps group them together.'
            : "Buzzar no longer updates your Buzzar space. You can leave the space from any Matrix app; turning this back on creates a new one.")}
      </Text>
    </SettingTile>
  );
}
