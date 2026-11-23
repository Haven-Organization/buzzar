/**
 * Buzzar (Third Room #295): your own walk, run and controller top speed (Settings → Controls), as a share of each
 * world's speeds and never above its top speed (engine/player/movement.common.ts). Kept in this browser.
 */
import { CSSProperties } from "react";

import { Button } from "../../../atoms/button/Button";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { useLocalStorage } from "../../../hooks/useLocalStorage";
import {
  DEFAULT_MOVEMENT,
  DEFAULT_MOVEMENT_PREFS,
  MAX_PREF,
  MIN_PREF,
  MOVEMENT_PREFS_KEY,
  MovementPrefs,
  parseMovementPrefs,
} from "../../../../engine/player/movement.common";
import "../things/ThingCloneDialog.css";

const fill = (value: number) =>
  ({ "--fill": `${(((value - MIN_PREF) / (MAX_PREF - MIN_PREF)) * 100).toFixed(1)}%` } as CSSProperties);

const LABEL: Record<keyof MovementPrefs, string> = {
  walk: "Walk Speed",
  run: "Run Speed",
  controller: "Controller Top Speed",
};

const DESCRIPTION: Record<keyof MovementPrefs, string> = {
  walk: "How fast you walk, compared with the world's walking speed.",
  run: "How fast you run, compared with the world's running speed.",
  controller:
    "With a controller stick pushed all the way (a part-way push is slower), compared with the world's running speed.",
};

/** The world speed each choice is a share of, in a world with Buzzar's normal speeds. */
const BASE: Record<keyof MovementPrefs, number> = {
  walk: DEFAULT_MOVEMENT.walkSpeed,
  run: DEFAULT_MOVEMENT.runSpeed,
  controller: DEFAULT_MOVEMENT.runSpeed,
};

export function MovementSpeedSetting({ which }: { which: keyof MovementPrefs }) {
  const [stored, setStored] = useLocalStorage<unknown>(MOVEMENT_PREFS_KEY, DEFAULT_MOVEMENT_PREFS);
  const prefs = parseMovementPrefs(stored);
  const value = prefs[which];
  const metres = Math.min(DEFAULT_MOVEMENT.maxSpeed, BASE[which] * value);

  return (
    <SettingTile label={<Label>{`${LABEL[which]}: ${Math.round(value * 100)}%`}</Label>}>
      <div className="ThingCloneDialog flex flex-column gap-xxs" style={{ padding: 0 }}>
        <input
          type="range"
          min={MIN_PREF}
          max={MAX_PREF}
          step={0.05}
          value={value}
          style={fill(value)}
          onChange={(e) => setStored({ ...prefs, [which]: Number(e.target.value) })}
          aria-label={LABEL[which]}
        />
        <div className="flex items-center gap-sm">
          <Text variant="b3" color="surface-low" className="grow">
            {DESCRIPTION[which]} In a world with normal speeds that&apos;s {metres.toFixed(1)} m/s. Worlds set a top
            speed you can&apos;t go past.
          </Text>
          <Button
            size="sm"
            fill="outline"
            disabled={value === DEFAULT_MOVEMENT_PREFS[which]}
            onClick={() => setStored({ ...prefs, [which]: DEFAULT_MOVEMENT_PREFS[which] })}
          >
            Reset
          </Button>
        </div>
      </div>
    </SettingTile>
  );
}
