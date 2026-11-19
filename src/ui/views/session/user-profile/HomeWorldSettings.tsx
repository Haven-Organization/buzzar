/**
 * Buzzar: Settings → Worlds: your Home World (which world it is, or create one if you skipped it) and whether
 * Buzzar takes you there when it starts.
 */
import { useState } from "react";
import { useAtom } from "jotai";

import { Switch } from "../../../atoms/button/Switch";
import { Button } from "../../../atoms/button/Button";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { createAndSetHomeWorld } from "../../../hooks/useHomeWorld";
import { enterHomeOnStartupAtom, homeWorldAtom } from "../../../state/homeWorld";

export function HomeWorldSettings() {
  const { session, platform, client } = useHydrogen(true);
  const [enterOnStartup, setEnterOnStartup] = useAtom(enterHomeOnStartupAtom);
  const [home, setHome] = useAtom(homeWorldAtom);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const homeName = home.status === "ready" ? session.rooms.get(home.roomId)?.name || "Your Home World" : undefined;

  const create = async () => {
    setCreating(true);
    setError(undefined);
    try {
      setHome({ status: "ready", roomId: await createAndSetHomeWorld(session, platform, client.sessionId) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <SettingTile className="grow basis-0" label={<Label>Home World</Label>}>
        {home.status === "checking" ? (
          <Text variant="b3" color="surface-low">
            Checking…
          </Text>
        ) : homeName ? (
          <Text variant="b3">{homeName}. To use another world, choose Set as Home World from its menu in Worlds.</Text>
        ) : (
          <div className="flex flex-column gap-xs items-start">
            <Text variant="b3" color="surface-low">
              You don't have a Home World yet.
            </Text>
            <Button size="sm" onClick={create} disabled={creating}>
              {creating ? "Creating…" : "Create Home World"}
            </Button>
          </div>
        )}
        {error && (
          <Text variant="b3" color="danger">
            {error}
          </Text>
        )}
      </SettingTile>
      <SettingTile className="grow basis-0" label={<Label>Enter Home World When Buzzar Starts</Label>}>
        <Switch checked={enterOnStartup} onCheckedChange={setEnterOnStartup} />
        <Text variant="b3" color="surface-low">
          Off: Buzzar opens on your Home World's page instead, without going in.
        </Text>
      </SettingTile>
    </>
  );
}
