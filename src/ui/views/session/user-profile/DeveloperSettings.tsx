/**
 * Buzzar: Settings → Developer: Developer Mode, and (with it on) the experimental features.
 */
import { useAtom } from "jotai";

import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { Switch } from "../../../atoms/button/Switch";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { useLocalStorage } from "../../../hooks/useLocalStorage";
import { developerModeAtom } from "../../../state/developerMode";
import { isSlidingSyncEnabled, setSlidingSyncEnabled } from "../../../../matrix";
import { confirmDialog } from "../../components/confirm-dialog/ConfirmDialog";

export function DeveloperSettings() {
  const [developerMode, setDeveloperMode] = useAtom(developerModeAtom);
  const [immersiveAR, setImmersiveAR] = useLocalStorage("feature_immersiveAR", false);
  const [sceneEditor, setSceneEditor] = useLocalStorage("feature_sceneEditor", false);

  const slidingSync = isSlidingSyncEnabled();
  // The setting is read when the session starts, so changing it reloads the app.
  const changeSlidingSync = async (enabled: boolean) => {
    const ok = await confirmDialog({
      title: enabled ? "Turn On Faster Sync?" : "Turn Off Faster Sync?",
      message: "Buzzar will reload to apply this. If you're in a world, you'll leave it.",
      confirmLabel: "Reload",
    });
    if (!ok) return;
    setSlidingSyncEnabled(enabled);
    window.location.reload();
  };

  return (
    <div className="flex flex-column gap-lg">
      <SettingTile label={<Label>Faster Sync (Experimental)</Label>}>
        <Switch checked={slidingSync} onCheckedChange={changeSlidingSync} />
        <Text variant="b3" color="surface-low">
          Loads your rooms much faster after signing in, by fetching each room's details only when they're needed
          (sliding sync). Needs a homeserver that supports it; still being tested, so turn it off if rooms or worlds
          look incomplete. Saved in this browser; changing it reloads Buzzar.
        </Text>
      </SettingTile>
      <SettingTile label={<Label>Developer Mode</Label>}>
        <Switch checked={developerMode} onCheckedChange={setDeveloperMode} />
        <Text variant="b3" color="surface-low">
          Tools for building and testing worlds: "Enter Without Script" in a world's menu (runs it without its script
          for one visit), and the experimental features below. Saved in this browser.
        </Text>
      </SettingTile>
      {developerMode && (
        <>
          <SettingTile label={<Label>Immersive AR (Experimental, Requires Refresh)</Label>}>
            <Switch checked={immersiveAR} onCheckedChange={setImmersiveAR} />
          </SettingTile>
          <SettingTile label={<Label>Scene Editor (Experimental, Requires Refresh)</Label>}>
            <Switch checked={sceneEditor} onCheckedChange={setSceneEditor} />
          </SettingTile>
        </>
      )}
    </div>
  );
}
