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

export function DeveloperSettings() {
  const [developerMode, setDeveloperMode] = useAtom(developerModeAtom);
  const [immersiveAR, setImmersiveAR] = useLocalStorage("feature_immersiveAR", false);
  const [sceneEditor, setSceneEditor] = useLocalStorage("feature_sceneEditor", false);

  return (
    <div className="flex flex-column gap-lg">
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
