import { ReactNode, useEffect, useState } from "react";

import { Text } from "../../../atoms/text/Text";
import { ThumbnailImg } from "../../../atoms/thumbnail/ThumbnailImg";
import { Tooltip } from "../../../atoms/tooltip/Tooltip";
import "./Hotbar.css";

interface HotbarSlotProps {
  imageSrc: string;
  label?: string;
  shortcutKey: string | number;
}

export function HotbarSlot({ imageSrc, label = "Object", shortcutKey }: HotbarSlotProps) {
  // Buzzar: a Thing with no picture (or one that won't load) shows its initial instead of a broken image.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageSrc]);
  return (
    <div className="HotbarSlot flex items-center">
      <Tooltip content={label}>
        {imageSrc && !failed ? (
          <ThumbnailImg src={imageSrc} alt={label} onError={() => setFailed(true)} />
        ) : (
          <div className="HotbarSlot__fallback flex items-center justify-center">
            <Text variant="b2" weight="bold" color="world">
              {label.trim().charAt(0).toUpperCase() || "?"}
            </Text>
          </div>
        )}
      </Tooltip>
      <Text className="HotbarSlot__key" variant="b3" color="world" weight="bold">
        {shortcutKey}
      </Text>
    </div>
  );
}

export function Hotbar({ children }: { children: ReactNode }) {
  return <div className="Hotbar flex gap-sm">{children}</div>;
}
