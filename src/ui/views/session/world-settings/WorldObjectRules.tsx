/**
 * Buzzar: which stock objects people may spawn in this world (software.haven.world.rules). Every visitor's
 * client enforces it, so objects that aren't allowed never show up for anyone but the person who broke the rule.
 */
import { useCallback, useState } from "react";
import { Room, StateEvent } from "@thirdroom/hydrogen-view-sdk";

import { SettingTile } from "../../components/setting-tile/SettingTile";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { Checkbox } from "../../../atoms/checkbox/Checkbox";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { usePowerLevels } from "../../../hooks/usePowerLevels";
import { useStateEventKeyCallback } from "../../../hooks/useStateEventKeyCallback";
import { STOCK_SPAWNABLES, WORLD_RULES_EVENT } from "../../../../engine/network/spawnRules.common";

const LABELS: Record<string, string> = {
  "small-crate": "Small Crate",
  "medium-crate": "Medium Crate",
  "large-crate": "Large Crate",
  "small-ball": "Ball",
  "mirror-ball": "Mirror Ball",
  "black-mirror-ball": "Black Mirror Ball",
  "emissive-ball": "Emissive Ball",
};

export function WorldObjectRules({ room }: { room: Room }) {
  const { session } = useHydrogen(true);
  const { getPowerLevel, canSendStateEvent } = usePowerLevels(room);
  const canEdit = canSendStateEvent(WORLD_RULES_EVENT, getPowerLevel(session.userId));
  const [content, setContent] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const onRules = useCallback((event: StateEvent | undefined) => {
    setContent((event?.content as Record<string, unknown>) ?? {});
  }, []);
  useStateEventKeyCallback(room, WORLD_RULES_EVENT, "", onRules);

  const objects = (content.objects ?? {}) as { allowed?: unknown };
  const allowed = Array.isArray(objects.allowed)
    ? objects.allowed.filter((id): id is string => typeof id === "string")
    : [...STOCK_SPAWNABLES];

  const toggle = async (id: string, on: boolean) => {
    const next = on ? [...new Set([...allowed, id])] : allowed.filter((a) => a !== id);
    const nextContent = {
      ...content,
      objects: { ...(content.objects as object), allowed: STOCK_SPAWNABLES.filter((s) => next.includes(s)) },
    };
    setSaving(true);
    setError(undefined);
    try {
      await session.hsApi.sendState(room.id, WORLD_RULES_EVENT, "", nextContent).response();
      setContent(nextContent);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingTile className="grow basis-0" label={<Label>Objects People Can Spawn</Label>}>
      <div className="flex flex-wrap gap-sm">
        {STOCK_SPAWNABLES.map((id) => (
          <label key={id} className="flex items-center gap-xxs">
            <Checkbox
              checked={allowed.includes(id)}
              disabled={!canEdit || saving}
              onCheckedChange={(on) => toggle(id, on === true)}
            />
            <Text variant="b2">{LABELS[id] ?? id}</Text>
          </label>
        ))}
      </div>
      <Text variant="b3" color="surface-low">
        Changes apply right away: objects that aren't allowed disappear for everyone, and every visitor's client
        refuses new ones (moderators are told who tried).
        {!canEdit && " You don't have permission to change this."}
      </Text>
      {error && (
        <Text variant="b3" color="danger">
          {error}
        </Text>
      )}
    </SettingTile>
  );
}
