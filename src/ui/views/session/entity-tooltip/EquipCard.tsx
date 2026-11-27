/**
 * Buzzar: when you pick up (or spawn into your hold) an Item that lists its controls (HAVEN_metadata controls), a
 * card like the hover card shows its name and what each input does with it for a few seconds, using this client's
 * own bindings.
 */
import { useEffect, useState } from "react";

import MouseIC from "../../../../../res/ic/mouse-left.svg";
import { ItemControl, ItemControlAction } from "../../../../engine/gltf/assetMetadata";
import { registerMessageHandler } from "../../../../engine/module/module.common";
import { ItemEquippedMessage, ThirdRoomMessageType } from "../../../../plugins/thirdroom/thirdroom.common";
import { Icon } from "../../../atoms/icon/Icon";
import { Text } from "../../../atoms/text/Text";
import { useActionKeyLabel } from "../../../hooks/useKeyBindings";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { useTouchControlsEnabled } from "../touch-controls/TouchControls";
import "./EntityTooltip.css";

/** How long the card stays up. */
const SHOW_MS = 6000;

/** The card's contents while it's showing (also so the hover card can step aside meanwhile). */
export function useEquippedItem() {
  const mainThread = useMainThreadContext();
  const [equipped, setEquipped] = useState<{ name: string; controls: ItemControl[]; at: number }>();
  useEffect(() => {
    let timer: number | undefined;
    const dispose = registerMessageHandler(
      mainThread,
      ThirdRoomMessageType.ItemEquipped,
      (_ctx, message: ItemEquippedMessage) => {
        setEquipped({ name: message.name, controls: message.controls, at: Date.now() });
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setEquipped(undefined), SHOW_MS);
      }
    );
    return () => {
      dispose();
      window.clearTimeout(timer);
    };
  }, [mainThread]);
  return equipped;
}

function Input({ action }: { action: ItemControlAction }) {
  const dropKey = useActionKeyLabel("grab");
  const rotateKey = useActionKeyLabel("straighten");
  const touch = useTouchControlsEnabled();
  if (touch) {
    const name = { use: "Use", secondary: "Throw", drop: "Use", throw: "Throw", rotate: "Turn Held" }[action];
    return <span className="EntityTooltip__boxedKey">{name}</span>;
  }
  if (action === "drop") return <span className="EntityTooltip__boxedKey">{dropKey}</span>;
  if (action === "rotate") return <span className="EntityTooltip__boxedKey">{rotateKey}</span>;
  return (
    <>
      <Icon src={MouseIC} size="sm" className="EntityTooltip__mouseIcon" color="world" />
      <span> {action === "use" ? "Left Click" : "Right Click"}</span>
    </>
  );
}

export function EquipCard({ equipped }: { equipped: { name: string; controls: ItemControl[] } }) {
  return (
    <div className="EntityTooltip EntityTooltip--equip">
      <Text weight="bold" color="world">
        {equipped.name}
      </Text>
      <div className="flex flex-column gap-xxs">
        {equipped.controls.map((control) => (
          <Text key={control.action + control.label} variant="b3" color="world">
            <Input action={control.action} />
            <span>: {control.label}</span>
          </Text>
        ))}
      </div>
    </div>
  );
}
