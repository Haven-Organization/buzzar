/**
 * Buzzar: Settings → Graphics → Avatar Culling, like VRChat's (engine/avatar/avatarCulling.common.ts). Kept in this
 * browser.
 */
import { CSSProperties } from "react";

import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { Switch } from "../../../atoms/button/Switch";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { useLocalStorage } from "../../../hooks/useLocalStorage";
import {
  AVATAR_CULLING_KEY,
  AvatarCullingSettings as Settings,
  DEFAULT_AVATAR_CULLING,
  HIDE_BEYOND_RANGE,
  parseAvatarCulling,
  SHOW_NEAREST_RANGE,
} from "../../../../engine/avatar/avatarCulling.common";
import "../items/ItemCloneDialog.css";

const fill = (value: number, [min, max]: [number, number]) =>
  ({ "--fill": `${(((value - min) / (max - min)) * 100).toFixed(1)}%` } as CSSProperties);

function SliderRow({
  label,
  on,
  value,
  range,
  unit,
  onToggle,
  onValue,
  description,
}: {
  label: string;
  on: boolean;
  value: number;
  range: [number, number];
  unit: string;
  onToggle: (on: boolean) => void;
  onValue: (value: number) => void;
  description: string;
}) {
  return (
    <SettingTile label={<Label>{`${label}: ${value}${unit}`}</Label>}>
      <div className="ItemCloneDialog flex flex-column gap-xxs" style={{ padding: 0 }}>
        <div className="flex items-center gap-sm">
          <Switch checked={on} onCheckedChange={onToggle} aria-label={label} />
          <input
            type="range"
            min={range[0]}
            max={range[1]}
            step={1}
            value={value}
            disabled={!on}
            style={{ ...fill(value, range), flexGrow: 1 }}
            onChange={(e) => onValue(Number(e.target.value))}
            aria-label={`${label} value`}
          />
        </div>
        <Text variant="b3" color="surface-low">
          {description}
        </Text>
      </div>
    </SettingTile>
  );
}

export function AvatarCullingSettings() {
  const [stored, setStored] = useLocalStorage<unknown>(AVATAR_CULLING_KEY, DEFAULT_AVATAR_CULLING);
  const settings = parseAvatarCulling(stored);
  const update = (patch: Partial<Settings>) => setStored({ ...settings, ...patch });

  return (
    <div className="flex flex-column gap-md">
      <Text variant="b2" weight="semi-bold">
        Avatar Culling
      </Text>
      <Text variant="b3" color="surface-low">
        Only the avatars near you are loaded and drawn, which helps a lot in busy worlds. Everyone else shows as a
        placeholder with their name until they come close.
      </Text>
      <SliderRow
        label="Hide Beyond"
        on={settings.hideBeyond.on}
        value={settings.hideBeyond.meters}
        range={HIDE_BEYOND_RANGE}
        unit=" m"
        onToggle={(on) => update({ hideBeyond: { ...settings.hideBeyond, on } })}
        onValue={(meters) => update({ hideBeyond: { ...settings.hideBeyond, meters } })}
        description="Hide avatars further away than this."
      />
      <SliderRow
        label="Show Nearest"
        on={settings.showNearest.on}
        value={settings.showNearest.count}
        range={SHOW_NEAREST_RANGE}
        unit=""
        onToggle={(on) => update({ showNearest: { ...settings.showNearest, on } })}
        onValue={(count) => update({ showNearest: { ...settings.showNearest, count } })}
        description="Show at most this many avatars, the nearest ones."
      />
      <SettingTile label={<Label>Always Show Friend Avatars</Label>}>
        <Switch
          checked={settings.alwaysShowFriends}
          onCheckedChange={(alwaysShowFriends) => update({ alwaysShowFriends })}
        />
        <Text variant="b3" color="surface-low">
          People you have direct messages with are never hidden.
        </Text>
      </SettingTile>
      <SettingTile label={<Label>Allow Override with &ldquo;Show Avatar&rdquo;</Label>}>
        <Switch checked={settings.allowOverride} onCheckedChange={(allowOverride) => update({ allowOverride })} />
        <Text variant="b3" color="surface-low">
          People you chose with &ldquo;Show Avatar&rdquo; (in a world&apos;s People list) are never hidden.
        </Text>
      </SettingTile>
    </div>
  );
}
