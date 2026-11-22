/**
 * Buzzar (Third Room #382): rebind keys (Settings → Controls). Click an action's key, then press the new one. A key
 * another action uses is swapped with it; Escape cancels.
 */
import { KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import classNames from "classnames";

import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { useKeyBindings } from "../../../hooks/useKeyBindings";
import {
  isCustomised,
  KEY_ACTIONS,
  KeyActionGroup,
  keyLabel,
  RESERVED_KEYS,
  resetAllKeys,
  resetKey,
  setKey,
} from "../../../../engine/input/keyBindings";
import { FixedControlsList } from "../world/ShortcutUI";
import "./KeyBindingsEditor.css";

const GROUPS: { group: KeyActionGroup; title: string }[] = [
  { group: "move", title: "Moving" },
  { group: "actions", title: "Objects" },
  { group: "interface", title: "Interface" },
];

function KeyCapture({ onKey, onCancel }: { onKey: (code: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // Nothing else (shortcuts, the game) sees this key.
    e.preventDefault();
    e.stopPropagation();
    if (e.code === "Escape") onCancel();
    else if (e.code) onKey(e.code);
  };
  return (
    <input
      ref={ref}
      className="KeyBindingsEditor__capture"
      readOnly
      value="Press a key…"
      aria-label="Press the new key, or Escape to cancel"
      onKeyDown={onKeyDown}
      onBlur={onCancel}
    />
  );
}

export function KeyBindingsEditor() {
  const keys = useKeyBindings();
  const [listening, setListening] = useState<string>();
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();

  const bind = (id: string, code: string) => {
    setListening(undefined);
    if (RESERVED_KEYS.has(code)) {
      setNotice({ text: `${keyLabel(code)} can't be used: it's needed elsewhere in Buzzar.`, error: true });
      return;
    }
    const action = KEY_ACTIONS.find((a) => a.id === id);
    try {
      const swapped = setKey(id, code);
      setNotice(
        swapped
          ? { text: `${action?.label} is now ${keyLabel(code)}, and ${swapped.label} moved to ${keyLabel(keys[id])}.` }
          : undefined
      );
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : String(error), error: true });
    }
  };

  return (
    <div className="KeyBindingsEditor flex flex-column gap-md">
      {GROUPS.map(({ group, title }) => (
        <div key={group} className="flex flex-column gap-xs">
          <Text variant="b3" weight="semi-bold" color="surface-low">
            {title}
          </Text>
          {KEY_ACTIONS.filter((action) => action.group === group).map((action) => {
            const custom = keys[action.id] !== action.defaultKey;
            return (
              <div key={action.id} className="KeyBindingsEditor__row flex items-center gap-sm">
                <Text variant="b2" className="grow">
                  {action.label}
                </Text>
                {custom && listening !== action.id && (
                  <Button
                    size="xs"
                    fill="none"
                    onClick={() => {
                      resetKey(action.id);
                      setNotice(undefined);
                    }}
                  >
                    {`Default (${keyLabel(action.defaultKey)})`}
                  </Button>
                )}
                {listening === action.id ? (
                  <KeyCapture onKey={(code) => bind(action.id, code)} onCancel={() => setListening(undefined)} />
                ) : (
                  <button
                    type="button"
                    className={classNames("KeyBindingsEditor__key", { "KeyBindingsEditor__key--custom": custom })}
                    onClick={() => {
                      setNotice(undefined);
                      setListening(action.id);
                    }}
                    aria-label={`${action.label}: ${keyLabel(keys[action.id])}. Change key`}
                  >
                    {keyLabel(keys[action.id])}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {notice && (
        <Text variant="b3" color={notice.error ? "danger" : "primary"}>
          {notice.text}
        </Text>
      )}
      <div className="flex items-center gap-sm">
        <Text variant="b3" color="surface-low" className="grow">
          Click a key, then press the new one. Keys are physical positions, so they stay put on any keyboard layout.
        </Text>
        <Button
          size="sm"
          fill="outline"
          disabled={!isCustomised()}
          onClick={() => {
            resetAllKeys();
            setNotice(undefined);
          }}
        >
          Reset All Keys
        </Button>
      </div>
      <div className="flex flex-column gap-xs">
        <Text variant="b3" weight="semi-bold" color="surface-low">
          Fixed
        </Text>
        <div className="ShortcutUI__list">
          <FixedControlsList />
        </div>
      </div>
    </div>
  );
}
