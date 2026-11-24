import { Fragment, ReactNode } from "react";

import { Kbd } from "../../../atoms/keyboard/Kbd";
import { Category } from "../../components/category/Category";
import { CategoryHeader } from "../../components/category/CategoryHeader";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { useKeyBindings } from "../../../hooks/useKeyBindings";
import { KEY_ACTIONS, keyLabel } from "../../../../engine/input/keyBindings";
import "./ShortcutUI.css";

function renderItem(name: string, kbd: ReactNode) {
  return (
    <div className="flex items-center">
      <Text variant="b2" className="grow">
        {name}
      </Text>
      <div className="inline-flex items-center gap-xs">{kbd}</div>
    </div>
  );
}

const key = (label: string) => (
  <Kbd key={label} size="xs">
    {label}
  </Kbd>
);
const combo = (...labels: string[]) =>
  labels.map((label, i) => (
    <span key={label} className="inline-flex items-center gap-xs">
      {i > 0 && <span>+</span>}
      {key(label)}
    </span>
  ));

/** Buzzar: keys that can't be rebound (see RESERVED_KEYS), shown with the rebindable ones. */
export function FixedControlsList() {
  return (
    <>
      {renderItem("Open/Close Overlay", <>{key("Tab")}</>)}
      {renderItem("Free Mouse (also closes menus)", key("Esc"))}
      {renderItem("Chat", key("Enter"))}
      {renderItem(
        "Spawn Your Shortcut Things",
        <>
          {key("1")} - {key("0")}
        </>
      )}
      {renderItem("Grab/Drop Object", key("Left Click"))}
      {renderItem("Throw Held Object", key("Right Click"))}
      {renderItem("Show Statistics", combo("Ctrl", "Shift", "S"))}
    </>
  );
}

/**
 * Buzzar: the keyboard and mouse controls, with your own keys (Third Room #382; rebind them in Settings → Controls,
 * which also shows this list).
 */
export function KeyboardControlsList() {
  const keys = useKeyBindings();
  const label = (id: string) => keyLabel(keys[id] ?? "");
  return (
    <div className="ShortcutUI__list">
      {KEY_ACTIONS.map((action) => (
        <Fragment key={action.id}>{renderItem(action.label, key(label(action.id)))}</Fragment>
      ))}
      {renderItem(
        `Climb a ladder: walk into it (${label("back")} down, ${label("jump")} lets go)`,
        key(label("forward"))
      )}
      <FixedControlsList />
    </div>
  );
}

/** Buzzar: the controller layout (standard mapping; see engine/input/gamepad.main.ts), also in Settings → Controls. */
export function ControllerControlsList() {
  return (
    <div className="ShortcutUI__list">
      {renderItem("Move (push all the way to run)", <Kbd size="xs">Left Stick</Kbd>)}
      {renderItem("Look", <Kbd size="xs">Right Stick</Kbd>)}
      {renderItem("Jump", <Kbd size="xs">A</Kbd>)}
      {renderItem("Crouch (hold to go prone)", <Kbd size="xs">L3</Kbd>)}
      {renderItem(
        "Grab / Use / Drop",
        <>
          <Kbd size="xs">R1</Kbd> / <Kbd size="xs">R2</Kbd>
        </>
      )}
      {renderItem("Throw Held Object", <Kbd size="xs">X</Kbd>)}
      {renderItem("Straighten Held Object (tap) / Rotate It (hold + Right Stick)", <Kbd size="xs">B</Kbd>)}
      {renderItem("Turn Held Object 45°", <Kbd size="xs">L1</Kbd>)}
      {renderItem("Mute", <Kbd size="xs">Y</Kbd>)}
      {renderItem("Names", <Kbd size="xs">D-pad Up</Kbd>)}
      {renderItem("Hide / show the HUD", <Kbd size="xs">D-pad Down</Kbd>)}
      {renderItem("Fly Mode", <Kbd size="xs">D-pad Right</Kbd>)}
      {renderItem("Delete Object", <Kbd size="xs">D-pad Left</Kbd>)}
      {renderItem("Menu", <Kbd size="xs">Start</Kbd>)}
      {renderItem("Controls", <Kbd size="xs">Back</Kbd>)}
    </div>
  );
}

export function ShortcutUI() {
  const keys = useKeyBindings();
  const [w, a, d, sk] = ["forward", "left", "right", "back"].map((id) => keyLabel(keys[id] ?? ""));
  return (
    <div className="ShortcutUI">
      <div className="ShortcutUI__main">
        <Text className="flex flex-column items-center gap-xs">
          <Kbd size="lg">{w}</Kbd>
          <span className="flex items-center gap-xs">
            <Kbd size="lg">{a}</Kbd>
            <Kbd size="lg">{sk}</Kbd>
            <Kbd size="lg">{d}</Kbd>
          </span>
        </Text>
        <Text className="text-center" style={{ marginTop: "var(--sp-lg)" }}>
          Use the {w}
          {a}
          {sk}
          {d} keys and mouse to move around and explore worlds.
        </Text>
      </div>
      <Category header={<CategoryHeader title="Action" options={<Label>Key</Label>} />}>
        <KeyboardControlsList />
      </Category>
      <Category header={<CategoryHeader title="Controller" options={<Label>Button</Label>} />}>
        <ControllerControlsList />
      </Category>
    </div>
  );
}
