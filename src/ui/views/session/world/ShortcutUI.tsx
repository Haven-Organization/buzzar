import { ReactNode } from "react";

import { Kbd } from "../../../atoms/keyboard/Kbd";
import { Category } from "../../components/category/Category";
import { CategoryHeader } from "../../components/category/CategoryHeader";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import "./ShortcutUI.css";

export function ShortcutUI() {
  const renderItem = (name: string, kbd: ReactNode) => (
    <div className="flex items-center">
      <Text variant="b2" className="grow">
        {name}
      </Text>
      <div className="inline-flex items-center gap-xs">{kbd}</div>
    </div>
  );

  return (
    <div className="ShortcutUI">
      <div className="ShortcutUI__main">
        <Text className="flex flex-column items-center gap-xs">
          <Kbd size="lg">W</Kbd>
          <span className="flex items-center gap-xs">
            <Kbd size="lg">A</Kbd>
            <Kbd size="lg">S</Kbd>
            <Kbd size="lg">D</Kbd>
          </span>
        </Text>
        <Text className="text-center" style={{ marginTop: "var(--sp-lg)" }}>
          Use the WASD keys and mouse to move around and explore worlds.
        </Text>
      </div>
      <Category header={<CategoryHeader title="Action" options={<Label>Key</Label>} />}>
        <div className="ShortcutUI__list">
          {renderItem(
            "Open/Close Overlay",
            <>
              <Kbd size="xs">Tab</Kbd> / <Kbd size="xs">Esc</Kbd>
            </>
          )}
          {renderItem(
            "Free/Capture Mouse",
            <>
              <Kbd size="xs">Shift</Kbd>
              <span>+</span>
              <Kbd size="xs">Tab</Kbd>
            </>
          )}
          {renderItem("Run", <Kbd size="xs">Shift</Kbd>)}
          {renderItem("Jump", <Kbd size="xs">Space</Kbd>)}
          {renderItem(
            "Crouch (hold to go prone)",
            <>
              <Kbd size="xs">C</Kbd>
            </>
          )}
          {renderItem("Prone", <Kbd size="xs">Z</Kbd>)}
          {renderItem(
            "Spawn Objects",
            <>
              <Kbd size="xs">1</Kbd> - <Kbd size="xs">6</Kbd>
            </>
          )}
          {renderItem(
            "Grab/Drop Object",
            <>
              <Kbd size="xs">E</Kbd> / <Kbd size="xs">Left Click</Kbd>
            </>
          )}
          {renderItem("Throw Held Object", <Kbd size="xs">Right Click</Kbd>)}
          {renderItem("Delete Object", <Kbd size="xs">X</Kbd>)}
          {renderItem("Fly Mode", <Kbd size="xs">B</Kbd>)}
          {renderItem("Third Person Camera Toggle", <Kbd size="xs">V</Kbd>)}
          {renderItem("Names: banners / names only / hidden", <Kbd size="xs">N</Kbd>)}
          {renderItem(
            "Show Statistics",
            <>
              <Kbd size="xs">Ctrl</Kbd>
              <span>+</span>
              <Kbd size="xs">Shift</Kbd>
              <span>+</span>
              <Kbd size="xs">S</Kbd>
            </>
          )}
        </div>
      </Category>
    </div>
  );
}
