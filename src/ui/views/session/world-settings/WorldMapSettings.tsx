/**
 * Buzzar (Third Room #461): World Settings → Map. The creator draws the world from above once ("Generate Map", on
 * their own machine, while in the world) and saves the picture; everyone else just downloads it. A map in the world
 * file itself (HAVEN_map) takes priority over this one.
 */
import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";

import { BlobHandle, Room } from "../../../../matrix";
import { Button } from "../../../atoms/button/Button";
import { Switch } from "../../../atoms/button/Switch";
import { Input } from "../../../atoms/input/Input";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { useMatrix } from "../../../hooks/useMatrix";
import { worldAtom } from "../../../state/world";
import { uploadAttachment } from "../../../utils/matrixUtils";
import { serializeMapEvent, WORLD_MAP_EVENT, WorldMapArea } from "../../../../plugins/world-map/worldMap.common";
import { generateWorldMap } from "../../../../plugins/world-map/worldMap.main";
import { useGeneratedWorldMap, useMapImageSrc } from "../world-map/useWorldMapImage";

const metres = (area: WorldMapArea) =>
  `${Math.round(area.maxX - area.minX)} × ${Math.round(area.maxZ - area.minZ)} m`;

export function WorldMapSettings({ room, canEdit }: { room: Room; canEdit: boolean }) {
  const mainThread = useMainThreadContext();
  const { session } = useMatrix(true);
  const world = useAtomValue(worldAtom);
  const inThisWorld = world.worldId === room.id && world.entered;

  const saved = useGeneratedWorldMap(room);
  const [cut, setCut] = useState(false);
  const [cutHeight, setCutHeight] = useState(2.5);
  useEffect(() => {
    if (saved?.cutHeight !== undefined) {
      setCut(true);
      setCutHeight(saved.cutHeight);
    }
  }, [saved?.cutHeight]);

  const [draft, setDraft] = useState<{ blob: Blob; area: WorldMapArea; cutHeight?: number }>();
  const [busy, setBusy] = useState<"generating" | "saving" | "removing">();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const shown = draft ?? saved;
  const src = useMapImageSrc(draft ? { ...draft.area, blob: draft.blob } : saved);

  const generate = async () => {
    setBusy("generating");
    setError(undefined);
    setNotice(undefined);
    try {
      const { blob, area } = await generateWorldMap(mainThread, cut ? cutHeight : undefined);
      setDraft({ blob, area, cutHeight: cut ? cutHeight : undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy("saving");
    setError(undefined);
    try {
      const extension = draft.blob.type === "image/webp" ? "webp" : "jpg";
      const file = new File([draft.blob], `world-map.${extension}`, { type: draft.blob.type });
      const mxc = await uploadAttachment(session.hsApi, BlobHandle.fromBlob(file));
      await session.hsApi
        .sendState(room.id, WORLD_MAP_EVENT, "", serializeMapEvent(mxc, draft.area, draft.cutHeight))
        .response();
      setDraft(undefined);
      setNotice("Map saved. Everyone in the world sees it on O.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const remove = async () => {
    setBusy("removing");
    setError(undefined);
    try {
      await session.hsApi.sendState(room.id, WORLD_MAP_EVENT, "", {}).response();
      setNotice("Map removed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="flex flex-column gap-md">
      <Text variant="b3" color="surface-low">
        People press O in the world to see a map with everyone on it. Generate the picture once here: it&apos;s drawn
        from straight above on your computer and saved with the world, so visitors only download a small image.
      </Text>
      {shown && src ? (
        <div className="flex flex-column gap-xs">
          <img
            src={src}
            alt="World map"
            style={{ maxWidth: "100%", maxHeight: 360, alignSelf: "flex-start", borderRadius: 8 }}
          />
          <Text variant="b3" color="surface-low">
            {draft ? "Not saved yet · " : ""}
            {metres("area" in shown ? shown.area : shown)}
          </Text>
        </div>
      ) : (
        <Text variant="b3" color="surface-low">
          This world has no map picture yet: the map shows everyone on a plain grid.
        </Text>
      )}
      <SettingTile label={<Label>Leave Out Everything Above a Height</Label>}>
        <div className="flex items-center gap-sm">
          <Switch
            checked={cut}
            disabled={!canEdit || !!busy}
            onCheckedChange={setCut}
            aria-label="Leave out everything above a height"
          />
          {cut && (
            <div className="flex items-center gap-xs" style={{ maxWidth: 160 }}>
              <Input
                type="number"
                step={0.5}
                value={cutHeight}
                disabled={!canEdit || !!busy}
                onChange={(e) => setCutHeight(Number(e.target.value) || 0)}
                aria-label="Height in metres"
              />
              <Text variant="b3">m</Text>
            </div>
          )}
        </div>
        <Text variant="b3" color="surface-low">
          For indoor worlds: roofs and upper floors are left out so the rooms show. Heights are the world&apos;s own (the
          floor is usually 0).
        </Text>
      </SettingTile>
      {canEdit && (
        <div className="flex flex-wrap gap-sm">
          <Button fill="outline" onClick={generate} disabled={!inThisWorld || !!busy}>
            {busy === "generating" ? "Drawing…" : saved || draft ? "Generate Again" : "Generate Map"}
          </Button>
          {draft && (
            <Button onClick={save} disabled={!!busy}>
              {busy === "saving" ? "Saving…" : "Save Map"}
            </Button>
          )}
          {saved && !draft && (
            <Button fill="outline" variant="danger" onClick={remove} disabled={!!busy}>
              {busy === "removing" ? "Removing…" : "Remove Map"}
            </Button>
          )}
        </div>
      )}
      {canEdit && !inThisWorld && (
        <Text variant="b3" color="surface-low">
          Enter this world to generate its map.
        </Text>
      )}
      {!canEdit && (
        <Text variant="b3" color="surface-low">
          You don&apos;t have permission to change the world&apos;s map.
        </Text>
      )}
      {notice && <Text variant="b3">{notice}</Text>}
      {error && (
        <Text variant="b3" color="danger">
          {error}
        </Text>
      )}
    </div>
  );
}
