/**
 * Buzzar (Third Room #156): with touch controls the HUD is just the mic and a "More" button, which opens this panel:
 * your Things to spawn (instead of the numbered bar) and the HUD's other buttons, with names to tap.
 */
import { ReactNode, useState } from "react";
import classNames from "classnames";

import { Text } from "../../../atoms/text/Text";
import { Icon } from "../../../atoms/icon/Icon";
import { IconButton } from "../../../atoms/button/IconButton";
import MoreIC from "../../../../../res/ic/more-horizontal.svg";
import { useActionBar } from "../../../hooks/useActionBar";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { Thread } from "../../../../engine/module/module.common";
import {
  isThingCloneId,
  SpawnThingMessage,
  thingKeyName,
  ThirdRoomMessageType,
} from "../../../../plugins/thirdroom/thirdroom.common";
import { STOCK_THINGS } from "../../../utils/thingsMatrix";
import "./TouchHudMenu.css";

export interface TouchHudAction {
  label: string;
  icon: string;
  onSelect: () => void;
  danger?: boolean;
}

/** A world script's own bar item isn't a Thing: it's used like pressing its number key. */
function pressNumberKey(key: string) {
  const code = `Digit${key}`;
  window.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
  // Released a moment later: a press and release in the same frame would be missed.
  window.setTimeout(() => window.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true })), 120);
}

export function TouchHudMenu({ actions, children }: { actions: TouchHudAction[]; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const mainThread = useMainThreadContext();
  const items = useActionBar();

  const close = () => {
    setOpen(false);
    // Nothing keeps focus, so the controls carry on at once.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const spawn = (id: string, key: string) => {
    close();
    if (isThingCloneId(id) || STOCK_THINGS.some((thing) => thing.id === id)) {
      mainThread.sendMessage<SpawnThingMessage>(Thread.Game, { type: ThirdRoomMessageType.SpawnThing, id });
    } else {
      pressNumberKey(key);
    }
  };

  return (
    <>
      {children}
      <IconButton
        variant="world"
        label={open ? "Close" : "More"}
        iconSrc={MoreIC}
        className={classNames("TouchHudMenu__toggle", { "TouchHudMenu__toggle--open": open })}
        onClick={() => (open ? close() : setOpen(true))}
      />
      {open && (
        <>
          <div className="TouchHudMenu__backdrop" onClick={close} />
          <div className="TouchHudMenu" role="menu">
            {items.length > 0 && (
              <>
                <Text variant="b3" color="world" weight="semi-bold">
                  Things
                </Text>
                <div className="TouchHudMenu__things">
                  {items.map((item, index) => {
                    const key = item.slot !== undefined ? thingKeyName(item.slot) : String((index + 1) % 10);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        className="TouchHudMenu__thing"
                        onClick={() => spawn(item.id, key)}
                      >
                        <img src={item.thumbnail} alt="" />
                        <Text variant="b3" color="world">
                          {item.label}
                        </Text>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <div className="TouchHudMenu__actions">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  className={classNames("TouchHudMenu__action", { "TouchHudMenu__action--danger": action.danger })}
                  onClick={() => {
                    close();
                    action.onSelect();
                  }}
                >
                  <Icon src={action.icon} color="world" size="sm" />
                  <Text variant="b3" color="world">
                    {action.label}
                  </Text>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
