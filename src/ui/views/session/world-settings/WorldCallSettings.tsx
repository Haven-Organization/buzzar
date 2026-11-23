/**
 * Buzzar: World Settings → Calls. The kind of call new visitors start in this world (src/matrix/callMethod.ts), kept
 * in its `software.haven.world.call` state event and sent with the window's Save, like the other settings. Players
 * only see and hear the others in the same call, so this is what keeps everyone together.
 */
import { CALL_METHOD_LABEL, CALL_METHODS, CallMethod } from "../../../../matrix";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { SelectInput } from "../../components/property-panel/SelectInput";

const DESCRIPTION: Record<CallMethod, string> = {
  mesh: "Every player connects to every other. Works with every Buzzar version; best for small groups (up to about 10).",
  livekit:
    "Everyone connects to a LiveKit server, which passes voices and movement on. Handles far more players. Needs a recent Buzzar, and a homeserver that offers LiveKit (for whoever starts the call).",
};

export function WorldCallSettings({
  value,
  onChange,
  canEdit,
}: {
  value: CallMethod;
  onChange: (value: CallMethod) => void;
  canEdit: boolean;
}) {
  return (
    <div className="flex flex-column gap-md">
      <SettingTile label={<Label>Recommended Call Type</Label>}>
        <SelectInput
          options={CALL_METHODS.map((method) => ({ value: method, label: CALL_METHOD_LABEL[method] }))}
          value={value}
          onChange={(method) => onChange(method as CallMethod)}
          disabled={!canEdit}
        />
        <Text variant="b3" color="surface-low">
          {DESCRIPTION[value]}
        </Text>
      </SettingTile>
      <Text variant="b3" color="surface-low">
        Players only see and hear the others in the same call. Whoever starts this world&apos;s call uses the type
        chosen here; someone arriving while a call of the other type is open is asked which one to join. Changing this
        doesn&apos;t move a call that&apos;s already running.
      </Text>
      {!canEdit && (
        <Text variant="b3" color="surface-low">
          Only people allowed to change this world&apos;s settings can change this.
        </Text>
      )}
    </div>
  );
}
