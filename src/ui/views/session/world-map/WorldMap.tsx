/**
 * Buzzar (Third Room #461): the world map, on O. A top-down picture of the world (the world file's own, else the one
 * its creator generated, else a plain grid) with a dot for everyone in it and an arrow for you. It doesn't take the
 * mouse: you can keep walking with it open. Positions only flow while it's open (see plugins/world-map).
 */
import { useEffect, useMemo, useState } from "react";

import { Room } from "../../../../matrix";
import { Text } from "../../../atoms/text/Text";
import { Kbd } from "../../../atoms/keyboard/Kbd";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { useKeyDown } from "../../../hooks/useKeyDown";
import { useMemberDisplayName } from "../../../hooks/useMemberDisplayName";
import { registerMessageHandler, Thread } from "../../../../engine/module/module.common";
import { inputFocused } from "../../../utils/common";
import {
  mapUV,
  WorldMapArea,
  WorldMapEnableMessage,
  WorldMapFileMapMessage,
  WorldMapImage,
  WorldMapMessageType,
  WorldMapPositionsMessage,
} from "../../../../plugins/world-map/worldMap.common";
import { isActionKey } from "../../../../engine/input/keyBindings";
import { useActionKeyLabel } from "../../../hooks/useKeyBindings";
import { useGeneratedWorldMap, useMapImageSrc } from "./useWorldMapImage";
import "./WorldMap.css";

/** Without a picture: an area around everyone, at least this wide (m). */
const MIN_GRID_SPAN = 40;

function gridArea(positions?: WorldMapPositionsMessage): WorldMapArea {
  const points = [...(positions?.self ? [positions.self] : []), ...(positions?.others ?? [])];
  if (points.length === 0) return { minX: -20, minZ: -20, maxX: 20, maxZ: 20 };
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const span = Math.max(MIN_GRID_SPAN, (maxX - minX) * 1.3, (maxZ - minZ) * 1.3);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  // Snapped, so the grid doesn't slide around as people move.
  const half = Math.ceil(span / 20) * 10;
  const sx = Math.round(cx / 10) * 10;
  const sz = Math.round(cz / 10) * 10;
  return { minX: sx - half, maxX: sx + half, minZ: sz - half, maxZ: sz + half };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function WorldMap({ room, blocked }: { room: Room; blocked: boolean }) {
  const mainThread = useMainThreadContext();
  const displayNameOf = useMemberDisplayName(room);
  const [open, setOpen] = useState(false);
  const [positions, setPositions] = useState<WorldMapPositionsMessage>();
  const [fileMap, setFileMap] = useState<WorldMapImage>();
  const generated = useGeneratedWorldMap(room);
  const image = fileMap ?? generated;
  const src = useMapImageSrc(image);
  const mapKey = useActionKeyLabel("map");

  useKeyDown(
    (e) => {
      if (!isActionKey(e, "map") || e.repeat || inputFocused()) return;
      if (blocked && !open) return;
      setOpen((o) => !o);
    },
    [blocked, open]
  );
  // The menu, chat or editor opening closes it.
  useEffect(() => {
    if (blocked) setOpen(false);
  }, [blocked]);

  useEffect(() => {
    mainThread.sendMessage<WorldMapEnableMessage>(Thread.Game, { type: WorldMapMessageType.Enable, enabled: open });
    if (!open) return;
    const disposers = [
      registerMessageHandler(mainThread, WorldMapMessageType.Positions, (_ctx, message: WorldMapPositionsMessage) =>
        setPositions(message)
      ),
      registerMessageHandler(mainThread, WorldMapMessageType.FileMap, (_ctx, message: WorldMapFileMapMessage) =>
        setFileMap(message.map)
      ),
    ];
    return () => {
      disposers.forEach((dispose) => dispose());
      mainThread.sendMessage<WorldMapEnableMessage>(Thread.Game, { type: WorldMapMessageType.Enable, enabled: false });
    };
  }, [mainThread, open]);

  const area = useMemo(() => (image && src ? image : gridArea(positions)), [image, src, positions]);
  if (!open) return null;

  const spanX = area.maxX - area.minX;
  const spanZ = area.maxZ - area.minZ;
  const self = positions?.self;
  const selfUV = self && mapUV(area, self.x, self.z);

  return (
    <div className="WorldMap" role="dialog" aria-label="World map">
      <div className="WorldMap__panel">
        <div
          className={src && image ? "WorldMap__map" : "WorldMap__map WorldMap__map--grid"}
          style={{ aspectRatio: `${spanX} / ${spanZ}`, ["--ratio" as string]: spanX / spanZ }}
        >
          {src && image && <img className="WorldMap__image" src={src} alt="" draggable={false} />}
          {positions?.others.map((p) => {
            const { u, v } = mapUV(area, p.x, p.z);
            const name = displayNameOf(p.peerId);
            return (
              <div
                key={p.peerId}
                className="WorldMap__person"
                style={{ left: `${clamp01(u) * 100}%`, top: `${clamp01(v) * 100}%` }}
                title={name}
              >
                <span className="WorldMap__dot" />
                <span className="WorldMap__name">{name}</span>
              </div>
            );
          })}
          {selfUV && (
            <div
              className="WorldMap__you"
              style={{
                left: `${clamp01(selfUV.u) * 100}%`,
                top: `${clamp01(selfUV.v) * 100}%`,
                transform: `translate(-50%, -50%) rotate(${self.heading}rad)`,
              }}
              aria-label="You"
            />
          )}
          <span className="WorldMap__north" aria-label="North">
            N
          </span>
        </div>
        <div className="WorldMap__footer">
          <Text variant="b3" color="world">
            {positions ? `${positions.others.length + 1} here` : "Finding everyone…"}
            {!(src && image) && " · This world has no map picture yet"}
          </Text>
          <Text variant="b3" color="world">
            <Kbd size="xs">{mapKey}</Kbd> Close
          </Text>
        </div>
      </div>
    </div>
  );
}
