/**
 * Buzzar: World Settings → Calls. The kind of call new visitors start in this world (src/matrix/callMethod.ts), kept in
 * its `software.haven.world.call` state event and saved as soon as it's changed. Players only see and hear the others
 * in the same call, so this is what keeps everyone together.
 */
import { useCallback, useState } from "react";

import {
  CALL_METHOD_LABEL,
  CALL_METHODS,
  CallMethod,
  DEFAULT_CALL_METHOD,
  recommendedCallMethod,
  Room,
  StateEvent,
  WORLD_CALL_EVENT,
} from "../../../../matrix";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { SelectInput } from "../../components/property-panel/SelectInput";
import { useMatrix } from "../../../hooks/useMatrix";
import { useStateEventKeyCallback } from "../../../hooks/useStateEventKeyCallback";

const DESCRIPTION: Record<CallMethod, string> = {
  mesh: "Every player connects to every other. Works with every Buzzar version; best for small groups (up to about 10).",
  livekit:
    "Everyone connects to a LiveKit server, which passes voices and movement on. Handles far more players. Needs a recent Buzzar, and a homeserver that offers LiveKit (for whoever starts the call).",
};

export function WorldCallSettings({ room, canEdit }: { room: Room; canEdit: boolean }) {
  const { session } = useMatrix(true);
  const [method, setMethod] = useState<CallMethod>(DEFAULT_CALL_METHOD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useStateEventKeyCallback(
    room,
    WORLD_CALL_EVENT,
    "",
    useCallback((event: StateEvent | undefined) => setMethod(recommendedCallMethod(event?.content)), [])
  );

  const change = async (value: string) => {
    const next = value as CallMethod;
    const previous = method;
    setMethod(next);
    setBusy(true);
    setError(undefined);
    try {
      await session.hsApi.sendState(room.id, WORLD_CALL_EVENT, "", { recommended_method: next }).response();
    } catch (e) {
      setMethod(previous);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-column gap-md">
      <SettingTile label={<Label>Recommended Call Type</Label>}>
        <SelectInput
          options={CALL_METHODS.map((value) => ({ value, label: CALL_METHOD_LABEL[value] }))}
          value={method}
          onChange={change}
          disabled={!canEdit || busy}
        />
        <Text variant="b3" color="surface-low">
          {DESCRIPTION[method]}
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
      {error && (
        <Text variant="b3" color="danger">
          Couldn&apos;t save: {error}
        </Text>
      )}
    </div>
  );
}
