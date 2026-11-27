/**
 * Buzzar (Third Room #295): World Settings → Movement: walking and running speed, the top speed players may choose,
 * jumping and flying. Kept in the rules event's `movement` and sent with Save. Every player's Buzzar holds everyone
 * else to these limits (engine/network/movementCheck.game.ts).
 */
import { CSSProperties } from "react";

import { Button } from "../../../atoms/button/Button";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { Switch } from "../../../atoms/button/Switch";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { DEFAULT_MOVEMENT, MovementRules } from "../../../../engine/player/movement.common";
import "../items/ItemCloneDialog.css";

const fill = (value: number, min: number, max: number) =>
  ({ "--fill": `${(((value - min) / (max - min)) * 100).toFixed(1)}%` } as CSSProperties);

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <SettingTile
      label={<Label>{`${label}: ${unit === "%" ? Math.round(value * 100) : value.toFixed(1)} ${unit}`}</Label>}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={fill(value, min, max)}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </SettingTile>
  );
}

export function WorldMovementSettings({
  value,
  onChange,
  disabled,
}: {
  value: MovementRules;
  onChange: (value: MovementRules) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<MovementRules>) => {
    const next = { ...value, ...patch };
    // Keep them in order: walk ≤ run ≤ top speed.
    next.runSpeed = Math.max(next.runSpeed, next.walkSpeed);
    next.maxSpeed = Math.max(next.maxSpeed, next.runSpeed);
    onChange(next);
  };
  const running = value.runSpeed > value.walkSpeed;
  const jumping = value.jump > 0;
  const reset = (note: string, keys: (keyof MovementRules)[]) => (
    <div className="flex items-center gap-sm">
      <Text variant="b3" color="surface-low" className="grow">
        {note}
      </Text>
      <Button
        size="sm"
        fill="outline"
        disabled={disabled || keys.every((key) => value[key] === DEFAULT_MOVEMENT[key])}
        onClick={() => set(Object.fromEntries(keys.map((key) => [key, DEFAULT_MOVEMENT[key]])))}
      >
        Reset
      </Button>
    </div>
  );

  return (
    <div className="ItemCloneDialog flex flex-column gap-md" style={{ padding: 0 }}>
      <Slider
        label="Walk Speed"
        unit="m/s"
        value={value.walkSpeed}
        min={0.5}
        max={15}
        step={0.5}
        disabled={disabled}
        onChange={(walkSpeed) => set({ walkSpeed })}
      />
      <SettingTile label={<Label>Running</Label>}>
        <div className="flex flex-column gap-xxs">
          <Switch
            checked={running}
            disabled={disabled}
            onCheckedChange={(on) =>
              set({ runSpeed: on ? Math.max(value.walkSpeed * 2.5, value.walkSpeed + 0.5) : value.walkSpeed })
            }
            aria-label="Running"
          />
          <Text variant="b3" color="surface-low">
            Off: running is no faster than walking.
          </Text>
        </div>
      </SettingTile>
      {running && (
        <Slider
          label="Run Speed"
          unit="m/s"
          value={value.runSpeed}
          min={0.5}
          max={30}
          step={0.5}
          disabled={disabled}
          onChange={(runSpeed) => set({ runSpeed })}
        />
      )}
      <SettingTile label={<Label>{`Top Speed Players May Choose: ${value.maxSpeed.toFixed(1)} m/s`}</Label>}>
        <div className="flex flex-column gap-xxs">
          <input
            type="range"
            min={0.5}
            max={50}
            step={0.5}
            value={value.maxSpeed}
            disabled={disabled}
            style={fill(value.maxSpeed, 0.5, 50)}
            onChange={(e) => set({ maxSpeed: Number(e.target.value) })}
            aria-label="Top speed players may choose"
          />
          <Text variant="b3" color="surface-low">
            Players can set their own walk and run speed in Settings → Controls, up to this. Set it to the run speed so
            nobody goes faster than you chose. Everyone&apos;s Buzzar holds players to it: someone moving faster (or
            flying faster, if flying is allowed) is held back and moderators are told.
          </Text>
        </div>
      </SettingTile>
      {reset("Normal: walk 2 m/s, run 5 m/s, players may choose up to 10 m/s.", ["walkSpeed", "runSpeed", "maxSpeed"])}
      <SettingTile label={<Label>Jumping</Label>}>
        <Switch
          checked={jumping}
          disabled={disabled}
          onCheckedChange={(on) => set({ jump: on ? 1 : 0 })}
          aria-label="Jumping"
        />
      </SettingTile>
      {jumping && (
        <Slider
          label="Jump Height"
          unit="%"
          value={value.jump}
          min={0.25}
          max={5}
          step={0.25}
          disabled={disabled}
          onChange={(jump) => set({ jump })}
        />
      )}
      {reset("Normal: jumping on, 100% height.", ["jump"])}
      <SettingTile label={<Label>Flying</Label>}>
        <div className="flex flex-column gap-xxs">
          <Switch checked={value.fly} disabled={disabled} onCheckedChange={(fly) => set({ fly })} aria-label="Flying" />
          <Text variant="b3" color="surface-low">
            Whether players can switch to flying. A world script can still make people fly
            (world.setCharacterController); allow flying here if it does, or they&apos;ll be held back.
          </Text>
        </div>
      </SettingTile>
      {value.fly && (
        <>
          <Slider
            label="Fly Speed"
            unit="m/s"
            value={value.flySpeed}
            min={1}
            max={50}
            step={1}
            disabled={disabled}
            onChange={(flySpeed) => set({ flySpeed })}
          />
          <Slider
            label="Fly Boost"
            unit="%"
            value={value.flyBoost}
            min={1}
            max={5}
            step={0.25}
            disabled={disabled}
            onChange={(flyBoost) => set({ flyBoost })}
          />
        </>
      )}
      {reset("Normal: flying on, 10 m/s with 200% boost.", ["fly", "flySpeed", "flyBoost"])}
    </div>
  );
}
