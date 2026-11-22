/**
 * Buzzar: clone a stock Thing with your own name and variables (Third Room #383), or edit a clone. Only the variables
 * the Thing has are offered (see plugins/spawnables/thingVariables.common.ts).
 */
import { CSSProperties, FormEvent, ReactNode, useState } from "react";

import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { IconButton } from "../../../atoms/button/IconButton";
import { Button } from "../../../atoms/button/Button";
import { Input } from "../../../atoms/input/Input";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import CrossIC from "../../../../../res/ic/cross.svg";
import { StockThing } from "../../../utils/thingsMatrix";
import { MAX_CLONE_NAME, newCloneId } from "../../../utils/thingClones";
import { ThingClone } from "../../../../plugins/thirdroom/thirdroom.common";
import {
  sanitizeThingVariables,
  THING_VARIABLE_DEFAULTS,
  THING_VARIABLE_LIMITS,
  thingVariable,
  ThingVariables,
} from "../../../../plugins/spawnables/thingVariables.common";
import "./ThingCloneDialog.css";

/** A stock Thing's size in metres at ×1 (for showing what a size multiplier means). */
export const STOCK_THING_METRES: Record<string, number> = {
  "small-crate": 1,
  "medium-crate": 1.75,
  "large-crate": 2.5,
  "mirror-ball": 1,
  "black-mirror-ball": 1,
  "emissive-ball": 2,
};

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const hex = (c: number) =>
  Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255)
    .toString(16)
    .padStart(2, "0");
const tintToHex = (t: [number, number, number]) => `#${t.map(hex).join("")}`;
const hexToTint = (value: string): [number, number, number] => [
  toLinear(parseInt(value.slice(1, 3), 16) / 255),
  toLinear(parseInt(value.slice(3, 5), 16) / 255),
  toLinear(parseInt(value.slice(5, 7), 16) / 255),
];

// Weight runs 0.1–500 kg on a log scale, so light and heavy are both easy to pick.
const { min: W_MIN, max: W_MAX } = THING_VARIABLE_LIMITS.weight;
const weightToSlider = (kg: number) => Math.log(kg / W_MIN) / Math.log(W_MAX / W_MIN);
const sliderToWeight = (t: number) => W_MIN * Math.pow(W_MAX / W_MIN, t);
const formatKg = (kg: number) => (kg < 10 ? kg.toFixed(1) : Math.round(kg).toString());

/** A short line describing a clone's variables, e.g. "0.5× · tinted · 20 kg". */
export function describeVariables(base: string, variables: ThingVariables): string {
  const parts: string[] = [];
  if (variables.size !== undefined) {
    const metres = STOCK_THING_METRES[base];
    parts.push(metres ? `${(metres * variables.size).toFixed(2)} m` : `${variables.size.toFixed(2)}×`);
  }
  if (variables.tint) parts.push("tinted");
  if (variables.bounciness !== undefined) parts.push(`bounce ${Math.round(variables.bounciness * 100)}%`);
  if (variables.weight !== undefined) parts.push(`${formatKg(variables.weight)} kg`);
  if (variables.glow !== undefined) parts.push(`glow ${variables.glow.toFixed(1)}`);
  if (variables.springiness !== undefined) parts.push(`surface bounce ${Math.round(variables.springiness * 100)}%`);
  return parts.length ? parts.join(" · ") : "Same as the original";
}

/** The slider's filled share, for its track (see ThingCloneDialog.css). */
const fill = (value: number, min: number, max: number) =>
  ({ "--fill": `${(Math.min(1, Math.max(0, (value - min) / (max - min))) * 100).toFixed(1)}%` } as CSSProperties);

function Row({ label, value, children }: { label: string; value: ReactNode; children: ReactNode }) {
  return (
    <SettingTile
      label={
        <div className="flex items-center gap-xs">
          <Label>{label}</Label>
          <Text variant="b3" color="surface-low">
            {value}
          </Text>
        </div>
      }
    >
      {children}
    </SettingTile>
  );
}

export function ThingCloneDialog({
  base,
  existing,
  initial,
  onSave,
  requestClose,
}: {
  base: StockThing;
  existing?: ThingClone;
  /** Starting values for a new clone (cloning a clone). */
  initial?: ThingClone;
  onSave: (clone: ThingClone) => Promise<void> | void;
  requestClose: () => void;
}) {
  const defaults = THING_VARIABLE_DEFAULTS[base.id] ?? {};
  const [name, setName] = useState(existing?.name ?? initial?.name ?? `My ${base.name}`);
  const [vars, setVars] = useState<ThingVariables>(existing?.variables ?? initial?.variables ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const get = <K extends keyof ThingVariables>(key: K) =>
    thingVariable(base.id, vars, key) as NonNullable<ThingVariables[K]>;
  const set = (patch: ThingVariables) => setVars((v) => ({ ...v, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSave({
        id: existing?.id ?? newCloneId(),
        base: base.id,
        name: name.trim().slice(0, MAX_CLONE_NAME) || base.name,
        variables: sanitizeThingVariables(base.id, vars),
      });
      requestClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const size = get("size");
  const metres = STOCK_THING_METRES[base.id];

  return (
    <div className="flex flex-column">
      <Header
        className="shrink-0"
        left={<HeaderTitle size="lg">{existing ? `Edit ${existing.name}` : `Clone ${base.name}`}</HeaderTitle>}
        right={<IconButton iconSrc={CrossIC} onClick={requestClose} label="Close" />}
      />
      <form onSubmit={submit} className="ThingCloneDialog flex flex-column gap-md">
        <SettingTile label={<Label>Name</Label>}>
          <Input
            value={name}
            maxLength={MAX_CLONE_NAME}
            onChange={(e) => setName(e.target.value)}
            required
            aria-label="Name"
          />
        </SettingTile>
        {defaults.size !== undefined && (
          <Row label="Size" value={metres ? `${(metres * size).toFixed(2)} m (${size.toFixed(2)}×)` : `${size.toFixed(2)}×`}>
            <input
              type="range"
              min={THING_VARIABLE_LIMITS.size.min}
              max={THING_VARIABLE_LIMITS.size.max}
              step={0.05}
              value={size}
              style={fill(size, THING_VARIABLE_LIMITS.size.min, THING_VARIABLE_LIMITS.size.max)}
              onChange={(e) => set({ size: Number(e.target.value) })}
              aria-label="Size"
            />
          </Row>
        )}
        {defaults.tint !== undefined && (
          <Row label="Colour" value={vars.tint ? "tinted" : "original"}>
            <div className="flex items-center gap-sm">
              <input type="color" aria-label="Colour" value={tintToHex(get("tint"))} onChange={(e) => set({ tint: hexToTint(e.target.value) })} />
              {vars.tint && (
                <Button size="sm" fill="none" onClick={() => set({ tint: undefined })}>
                  Original Colour
                </Button>
              )}
            </div>
          </Row>
        )}
        {defaults.bounciness !== undefined && (
          <Row label="Bounciness" value={`${Math.round(get("bounciness") * 100)}%`}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={get("bounciness")}
              style={fill(get("bounciness"), 0, 1)}
              onChange={(e) => set({ bounciness: Number(e.target.value) })}
              aria-label="Bounciness"
            />
          </Row>
        )}
        {defaults.weight !== undefined && (
          <Row label="Weight" value={`${formatKg(get("weight"))} kg`}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={weightToSlider(get("weight"))}
              style={fill(weightToSlider(get("weight")), 0, 1)}
              onChange={(e) => set({ weight: Number(sliderToWeight(Number(e.target.value)).toPrecision(3)) })}
              aria-label="Weight"
            />
          </Row>
        )}
        {defaults.glow !== undefined && (
          <Row label="Glow" value={get("glow").toFixed(1)}>
            <input
              type="range"
              min={THING_VARIABLE_LIMITS.glow.min}
              max={THING_VARIABLE_LIMITS.glow.max}
              step={0.1}
              value={get("glow")}
              style={fill(get("glow"), THING_VARIABLE_LIMITS.glow.min, THING_VARIABLE_LIMITS.glow.max)}
              onChange={(e) => set({ glow: Number(e.target.value) })}
              aria-label="Glow"
            />
          </Row>
        )}
        {defaults.springiness !== undefined && (
          <Row label="Surface Bounce" value={`${Math.round(get("springiness") * 100)}%`}>
            <input
              type="range"
              min={THING_VARIABLE_LIMITS.springiness.min}
              max={THING_VARIABLE_LIMITS.springiness.max}
              step={0.05}
              value={get("springiness")}
              style={fill(get("springiness"), THING_VARIABLE_LIMITS.springiness.min, THING_VARIABLE_LIMITS.springiness.max)}
              onChange={(e) => set({ springiness: Number(e.target.value) })}
              aria-label="Surface bounce"
            />
          </Row>
        )}
        <Text variant="b3" color="surface-low">
          Others see your clone as you made it. Spawned objects are still {base.name}s to world rules.
        </Text>
        {error && (
          <Text variant="b3" color="danger">
            {error}
          </Text>
        )}
        <div className="flex justify-end gap-sm">
          <Button fill="outline" onClick={() => setVars({})} disabled={saving}>
            Reset
          </Button>
          <Button type="submit" disabled={saving}>
            {existing ? "Save" : "Create Clone"}
          </Button>
        </div>
      </form>
    </div>
  );
}
