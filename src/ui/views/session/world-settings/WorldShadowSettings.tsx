/**
 * Buzzar (Third Room #204): a world's shadows (World Settings → Lighting), kept in its rules event as `shadows`.
 * Off unless the world's creator turns them on: lighting tuned without shadows (a sideways fill light, an open-topped
 * room) can look wrong with them. People can still turn shadows off for themselves in Settings → Graphics.
 */
import { CSSProperties } from "react";

import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { Switch } from "../../../atoms/button/Switch";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { parseWorldShadows } from "../../../../engine/renderer/renderer.common";
import "../things/ThingCloneDialog.css";

export interface WorldShadowsDraft {
  sun: boolean;
  bakedSun: boolean;
  azimuth: number;
  elevation: number;
  strength: number;
}

export function shadowsDraftFromRules(content: Record<string, unknown> | undefined): WorldShadowsDraft {
  const parsed = parseWorldShadows(content?.shadows);
  const raw = (content?.shadows ?? {}) as { baked_sun?: Record<string, unknown> };
  const baked = parsed.bakedSun ?? parseWorldShadows({ baked_sun: { ...raw.baked_sun, enabled: true } }).bakedSun!;
  return { sun: parsed.sun, bakedSun: !!parsed.bakedSun, ...baked };
}

export function serializeShadows(draft: WorldShadowsDraft) {
  return {
    sun: draft.sun,
    baked_sun: { enabled: draft.bakedSun, azimuth: draft.azimuth, elevation: draft.elevation, strength: draft.strength },
  };
}

const fill = (value: number, min: number, max: number) =>
  ({ "--fill": `${(((value - min) / (max - min)) * 100).toFixed(1)}%` } as CSSProperties);

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function WorldShadowSettings({
  value,
  onChange,
  disabled,
}: {
  value: WorldShadowsDraft;
  onChange: (value: WorldShadowsDraft) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<WorldShadowsDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="ThingCloneDialog flex flex-column gap-md" style={{ padding: 0 }}>
      <SettingTile label={<Label>Sun Shadows</Label>}>
        <div className="flex flex-column gap-xxs">
          <Switch
            checked={value.sun}
            disabled={disabled}
            onCheckedChange={(sun) => set({ sun, bakedSun: sun ? false : value.bakedSun })}
            aria-label="Sun shadows"
          />
          <Text variant="b3" color="surface-low">
            The world&apos;s directional light casts shadows, and everything casts and receives them. Turn this on if
            that light is a real sun; leave it off if it&apos;s a fill light, or indoors can look oddly shaded.
          </Text>
        </div>
      </SettingTile>
      <SettingTile label={<Label>Shadows in Baked Lighting</Label>}>
        <div className="flex flex-column gap-xxs">
          <Switch
            checked={value.bakedSun}
            disabled={disabled}
            onCheckedChange={(bakedSun) => set({ bakedSun, sun: bakedSun ? false : value.sun })}
            aria-label="Shadows in baked lighting"
          />
          <Text variant="b3" color="surface-low">
            For worlds whose lighting is baked into lightmaps: moving things and people cast shadows from this direction
            (match it to the baked light), without relighting the world.
          </Text>
        </div>
      </SettingTile>
      {value.bakedSun && (
        <>
          <SettingTile
            label={
              <Label>
                Light From: {COMPASS[Math.round(value.azimuth / 45) % 8]} ({Math.round(value.azimuth)}°)
              </Label>
            }
          >
            <input
              type="range"
              min={0}
              max={360}
              step={5}
              value={value.azimuth}
              disabled={disabled}
              style={fill(value.azimuth, 0, 360)}
              onChange={(e) => set({ azimuth: Number(e.target.value) })}
              aria-label="Light direction (degrees from north)"
            />
          </SettingTile>
          <SettingTile label={<Label>Height Above the Horizon: {Math.round(value.elevation)}°</Label>}>
            <input
              type="range"
              min={5}
              max={90}
              step={1}
              value={value.elevation}
              disabled={disabled}
              style={fill(value.elevation, 5, 90)}
              onChange={(e) => set({ elevation: Number(e.target.value) })}
              aria-label="Light height above the horizon"
            />
          </SettingTile>
          <SettingTile label={<Label>Shadow Darkness: {Math.round(value.strength * 100)}%</Label>}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={value.strength}
              disabled={disabled}
              style={fill(value.strength, 0, 1)}
              onChange={(e) => set({ strength: Number(e.target.value) })}
              aria-label="Shadow darkness"
            />
          </SettingTile>
        </>
      )}
      <Text variant="b3" color="surface-low">
        People can turn shadows off or lower their quality for themselves in Settings → Graphics.
      </Text>
    </div>
  );
}
