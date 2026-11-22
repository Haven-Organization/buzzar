/**
 * Buzzar: Settings → Controls: which controller to play with, the controllers connected right now, and the keyboard,
 * mouse and controller layouts, and the touch controls (Third Room #156). Keys can be rebound here (KeyBindingsEditor).
 */
import { useEffect, useMemo, useState } from "react";
import classNames from "classnames";
import { useAtom } from "jotai";

import { Label } from "../../../atoms/text/Label";
import { Switch } from "../../../atoms/button/Switch";
import { autoRunAtom } from "../../../state/autoRun";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { SelectInput } from "../../components/property-panel/SelectInput";
import { Category } from "../../components/category/Category";
import { CategoryHeader } from "../../components/category/CategoryHeader";
import { ControllerControlsList } from "../world/ShortcutUI";
import { KeyBindingsEditor } from "./KeyBindingsEditor";
import {
  getTouchControlsSetting,
  isMobileBrowser,
  onTouchControlsSetting,
  setTouchControlsSetting,
  TouchControlsSetting,
} from "../../../../engine/input/touchControls";
import { useActionKeyLabel } from "../../../hooks/useKeyBindings";
import {
  GamepadChoice,
  getGamepadChoice,
  onGamepadChoice,
  pickGamepads,
  setGamepadChoice,
} from "../../../../engine/input/gamepadPreference";
import "./ControlsSettings.css";

interface PadInfo {
  index: number;
  id: string;
  standard: boolean;
  /** A button is pressed or a stick pushed right now (to tell which pad is which). */
  active: boolean;
}

/** "Xbox 360 Controller (XInput STANDARD GAMEPAD)" → "Xbox 360 Controller". */
export function gamepadName(id: string) {
  const name = id.replace(/\s*\((?:[^()]*\b(?:STANDARD GAMEPAD|Vendor:|XInput)[^()]*)\)\s*$/i, "").trim();
  return name || id;
}

function readPads(): PadInfo[] {
  const pads = Array.from(navigator.getGamepads?.() ?? []).filter((pad): pad is Gamepad => !!pad && pad.connected);
  return pads.map((pad) => ({
    index: pad.index,
    id: pad.id,
    standard: pad.mapping === "standard",
    active: pad.buttons.some((b) => b.pressed || b.value > 0.5) || pad.axes.some((a) => Math.abs(a) > 0.5),
  }));
}

/** The connected controllers, refreshed as they're plugged in, unplugged and used. */
function useConnectedGamepads(): PadInfo[] {
  const [pads, setPads] = useState<PadInfo[]>(readPads);
  useEffect(() => {
    let last = JSON.stringify(pads);
    const update = () => {
      const next = readPads();
      const json = JSON.stringify(next);
      if (json === last) return;
      last = json;
      setPads(next);
    };
    // The Gamepad API only reports state when asked, so poll while Settings is open.
    const timer = window.setInterval(update, 100);
    window.addEventListener("gamepadconnected", update);
    window.addEventListener("gamepaddisconnected", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("gamepadconnected", update);
      window.removeEventListener("gamepaddisconnected", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return pads;
}

function useGamepadChoice(): [GamepadChoice, (choice: GamepadChoice) => void] {
  const [choice, setChoice] = useState(getGamepadChoice);
  useEffect(() => onGamepadChoice(setChoice), []);
  return [choice, setGamepadChoice];
}

const choiceKey = (choice: GamepadChoice) => (choice.kind === "pad" ? `pad:${choice.index}:${choice.id}` : choice.kind);

export function ControlsSettings() {
  const pads = useConnectedGamepads();
  const [choice, setChoice] = useGamepadChoice();
  const [autoRun, setAutoRun] = useAtom(autoRunAtom);
  const [touchSetting, setTouchSetting] = useState(getTouchControlsSetting);
  useEffect(() => onTouchControlsSetting(() => setTouchSetting(getTouchControlsSetting())), []);
  const mobile = isMobileBrowser();
  const runKey = useActionKeyLabel("run");

  const options = useMemo(() => {
    const list: { value: string; label: string; choice: GamepadChoice }[] = [
      { value: "any", label: "Any connected controller", choice: { kind: "any" } },
    ];
    for (const pad of pads) {
      const padChoice: GamepadChoice = { kind: "pad", id: pad.id, index: pad.index };
      list.push({
        value: choiceKey(padChoice),
        label: `${gamepadName(pad.id)} (slot ${pad.index + 1})`,
        choice: padChoice,
      });
    }
    if (choice.kind === "pad" && !list.some((option) => option.value === choiceKey(choice))) {
      // The picked one isn't connected (or is in another slot): keep it selectable so the choice stays visible.
      const reconnected = pads.find((pad) => pad.id === choice.id);
      list.push({
        value: choiceKey(choice),
        label: reconnected
          ? `${gamepadName(choice.id)} (slot ${choice.index + 1}, now in slot ${reconnected.index + 1})`
          : `${gamepadName(choice.id)} (not connected)`,
        choice,
      });
    }
    list.push({ value: "none", label: "None: keyboard and mouse only", choice: { kind: "none" } });
    return list;
  }, [pads, choice]);

  const inUse = new Set(pickGamepads(pads, choice).map((pad) => pad.index));

  return (
    <div className="ControlsSettings flex flex-column gap-lg">
      <SettingTile label={<Label>Touch Controls</Label>}>
        <SelectInput
          options={[
            {
              value: "auto",
              label: mobile ? "Automatic (on: this is a phone or tablet)" : "Automatic (off: not a phone or tablet)",
            },
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
          value={touchSetting}
          onChange={(value) => setTouchControlsSetting(value as TouchControlsSetting)}
        />
        <Text variant="b3" color="surface-low">
          A joystick to move and buttons to jump, crouch, use and throw (fly and more are under ⋯). Drag anywhere else
          to look around.
        </Text>
      </SettingTile>

      <SettingTile label={<Label>Controller</Label>}>
        <SelectInput
          options={options.map(({ value, label }) => ({ value, label }))}
          value={choiceKey(choice)}
          onChange={(value) => {
            const picked = options.find((option) => option.value === value);
            if (picked) setChoice(picked.choice);
          }}
        />
        <Text variant="b3" color="surface-low">
          {choice.kind === "any"
            ? "Every connected controller works. Pick one to ignore the others (e.g. a second player's pad, or one that drifts)."
            : choice.kind === "none"
            ? "Controllers are ignored."
            : inUse.size === 0
            ? "That controller isn't connected, so no controller is in use. Press a button on it once it's plugged in."
            : "Only this controller is used."}
        </Text>
      </SettingTile>

      <SettingTile label={<Label>Connected Controllers</Label>}>
        {pads.length === 0 ? (
          <Text variant="b3" color="surface-low">
            None found. Plug one in (or pair it) and press any button: browsers only list a controller once it's used.
          </Text>
        ) : (
          <div className="ControlsSettings__pads flex flex-column gap-xs">
            {pads.map((pad) => (
              <div key={pad.index} className="ControlsSettings__pad flex items-center gap-sm">
                <span
                  className={classNames("ControlsSettings__light", { "ControlsSettings__light--on": pad.active })}
                  title="Lights up while you press a button on it"
                />
                <div className="grow flex flex-column">
                  <Text variant="b2" weight="medium" className="truncate">
                    {gamepadName(pad.id)}
                  </Text>
                  <Text variant="b3" color="surface-low">
                    Slot {pad.index + 1}
                    {pad.standard ? "" : " · unrecognised layout: buttons may not match the list below"}
                  </Text>
                </div>
                <Text variant="b3" color={inUse.has(pad.index) ? "primary" : "surface-low"} weight="medium">
                  {inUse.has(pad.index) ? "In use" : "Not used"}
                </Text>
              </div>
            ))}
            <Text variant="b3" color="surface-low">
              Press a button to see which one is which.
            </Text>
          </div>
        )}
      </SettingTile>

      <Category header={<CategoryHeader title="Keyboard and Mouse" options={<Label>Key</Label>} />}>
        <SettingTile className="ControlsSettings__autoRun" label={<Label>Auto Run</Label>}>
          <Switch checked={autoRun} onCheckedChange={setAutoRun} />
          <Text variant="b3" color="surface-low">
            Moving with the keys runs, and holding {runKey} walks instead.
          </Text>
        </SettingTile>
        <KeyBindingsEditor />
      </Category>
      <Category header={<CategoryHeader title="Controller" options={<Label>Button</Label>} />}>
        <ControllerControlsList />
      </Category>
    </div>
  );
}
