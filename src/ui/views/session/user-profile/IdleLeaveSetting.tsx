/** Buzzar: Settings → Worlds & Scripts → Leave Worlds When Away (hooks/useIdleLeave.ts). */
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { SelectInput } from "../../components/property-panel/SelectInput";
import { IDLE_LEAVE_CHOICES, useIdleLeaveMinutes } from "../../../hooks/useIdleLeave";

const label = (minutes: number) =>
  minutes === 0
    ? "Never"
    : minutes < 60
    ? `After ${minutes} minutes`
    : `After ${minutes / 60} hour${minutes === 60 ? "" : "s"}`;

export function IdleLeaveSetting() {
  const [minutes, setMinutes] = useIdleLeaveMinutes();
  return (
    <SettingTile label={<Label>Leave Worlds When Away</Label>}>
      <SelectInput
        options={IDLE_LEAVE_CHOICES.map((value) => ({ value: String(value), label: label(value) }))}
        value={String(minutes)}
        onChange={(value) => setMinutes(Number(value))}
      />
      <Text variant="b3" color="surface-low">
        While the menu is open or Buzzar is hidden for this long, you&apos;re asked if you&apos;re still there, and a
        minute later you leave the world, so people there don&apos;t keep seeing an avatar nobody&apos;s behind. Choose
        Never to stay in worlds as long as you like. Saved in this browser.
      </Text>
    </SettingTile>
  );
}
