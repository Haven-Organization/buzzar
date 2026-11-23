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
import {
  CALL_METHOD_LABEL,
  CALL_METHOD_OVERRIDE_KEY,
  CALL_METHODS,
  CallMethodOverride,
  isSlidingSyncEnabled,
  setSlidingSyncEnabled,
} from "../../../../matrix";
import { SelectInput } from "../../components/property-panel/SelectInput";
import { LIMIT_OVERRIDES_KEY, LimitOverrides } from "../../../../engine/player/movement.common";
import { confirmDialog } from "../../components/confirm-dialog/ConfirmDialog";

const NO_OVERRIDES: Partial<LimitOverrides> = {};

export function DeveloperSettings() {
  const [developerMode, setDeveloperMode] = useAtom(developerModeAtom);
  const [immersiveAR, setImmersiveAR] = useLocalStorage("feature_immersiveAR", false);
  const [sceneEditor, setSceneEditor] = useLocalStorage("feature_sceneEditor", false);
  const [overrides, setOverrides] = useLocalStorage<Partial<LimitOverrides>>(LIMIT_OVERRIDES_KEY, NO_OVERRIDES);
  const setOverride = (key: keyof LimitOverrides, value: boolean) =>
    setOverrides({ ignoreOwn: !!overrides.ignoreOwn, ignoreOthers: !!overrides.ignoreOthers, [key]: value });
  const [callMethod, setCallMethod] = useLocalStorage<CallMethodOverride>(CALL_METHOD_OVERRIDE_KEY, "recommended");

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
          <SettingTile label={<Label>Ignore World Limits for My Actions</Label>}>
            <Switch checked={!!overrides.ignoreOwn} onCheckedChange={(on) => setOverride("ignoreOwn", on)} />
            <Text variant="b3" color="surface-low">
              Lets you break a world&apos;s rules on your own screen: spawn Things it blocks or more than its limit,
              fly, jump and move faster than it allows. Other players&apos; Buzzar still blocks all of that, so they
              won&apos;t see those objects and will see you held back. World moderators are told each time and may kick
              or ban you. For testing worlds; you&apos;re reminded when you enter a world with it on.
            </Text>
          </SettingTile>
          <SettingTile label={<Label>Don&apos;t Enforce World Limits on Others for Me</Label>}>
            <Switch checked={!!overrides.ignoreOthers} onCheckedChange={(on) => setOverride("ignoreOthers", on)} />
            <Text variant="b3" color="surface-low">
              Shows what other players send even when it breaks the world&apos;s rules (blocked Things, too many
              objects, moving too fast), so you may see things nobody else does. Useful for debugging, or for moderators
              who want to see what a rule-breaker is doing. Nobody can move or delete someone else&apos;s things either
              way.
            </Text>
          </SettingTile>
          <SettingTile label={<Label>Call Type for New World Calls</Label>}>
            <SelectInput
              options={[
                { value: "recommended", label: "The world's recommended type" },
                ...CALL_METHODS.map((value) => ({ value, label: CALL_METHOD_LABEL[value] })),
              ]}
              value={callMethod}
              onChange={(value) => setCallMethod(value as CallMethodOverride)}
            />
            <Text variant="b3" color="surface-low">
              The kind of call you start when you enter a world nobody is in, ignoring the world&apos;s recommendation
              (World Settings → Calls). If a call of another kind is already open, you&apos;re asked which to join.
              Players only see and hear the others in the same call. Saved in this browser.
            </Text>
          </SettingTile>
        </>
      )}
    </div>
  );
}
