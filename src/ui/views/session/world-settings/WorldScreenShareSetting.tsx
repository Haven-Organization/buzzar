/**
 * Buzzar (Third Room #398): World Settings → Calls → who may share their screen (the rules event's `screen_share`,
 * engine/screenshare/screenShare.common.ts). Everyone's Buzzar applies it to what they see.
 */
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { SelectInput } from "../../components/property-panel/SelectInput";
import { SCREEN_SHARE_RULES, ScreenShareRule } from "../../../../engine/screenshare/screenShare.common";

const LABEL: Record<ScreenShareRule, string> = {
  everyone: "Everyone",
  moderators: "Moderators only",
  nobody: "Nobody",
};

export function WorldScreenShareSetting({
  value,
  onChange,
  canEdit,
}: {
  value: ScreenShareRule;
  onChange: (value: ScreenShareRule) => void;
  canEdit: boolean;
}) {
  return (
    <SettingTile label={<Label>Who Can Share Their Screen</Label>}>
      <SelectInput
        options={SCREEN_SHARE_RULES.map((rule) => ({ value: rule, label: LABEL[rule] }))}
        value={value}
        onChange={onChange}
        disabled={!canEdit}
      />
      <Text variant="b3" color="surface-low">
        Shared screens float in front of their sharer or show on the world&apos;s screens (HAVEN_screen), for everyone
        in a LiveKit call. Moderators are people who can kick. Everyone&apos;s Buzzar hides screens from people this
        doesn&apos;t allow.
      </Text>
    </SettingTile>
  );
}
