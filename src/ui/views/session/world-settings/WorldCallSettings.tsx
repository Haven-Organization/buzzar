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
import { Input } from "../../../atoms/input/Input";
import { MAX_INSTANCE_CAP, MIN_INSTANCE_CAP } from "../../../../matrix/instances";

const DESCRIPTION: Record<CallMethod, string> = {
  mesh: "Every player connects to every other. Works with every Buzzar version; best for small groups (up to about 10).",
  livekit:
    "Everyone connects to a LiveKit server, which passes voices and movement on. Handles far more players. Needs a recent Buzzar, and a homeserver that offers LiveKit (for whoever starts the call).",
};

export function WorldCallSettings({
  value,
  onChange,
  instanceCap,
  onInstanceCapChange,
  canEdit,
}: {
  value: CallMethod;
  onChange: (value: CallMethod) => void;
  /** Players per instance (src/matrix/instances.ts). */
  instanceCap: number;
  onInstanceCapChange: (value: number) => void;
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
      <SettingTile label={<Label>Players per Instance</Label>}>
        <div style={{ maxWidth: 120 }}>
          <Input
            type="number"
            min={MIN_INSTANCE_CAP}
            max={MAX_INSTANCE_CAP}
            value={instanceCap}
            disabled={!canEdit}
            onChange={(event) => {
              const n = Math.round(Number(event.target.value));
              if (Number.isFinite(n)) onInstanceCapChange(Math.min(MAX_INSTANCE_CAP, Math.max(MIN_INSTANCE_CAP, n)));
            }}
            aria-label="Players per instance"
          />
        </div>
        <Text variant="b3" color="surface-low">
          LiveKit calls are split into instances, separate copies of the world (like VRChat&apos;s). Someone entering
          joins the busiest instance with room, and a new one starts when all are full. Anyone can start a new instance
          or join a full one from the world&apos;s Instances list. Peer-to-peer calls have no instances.
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
