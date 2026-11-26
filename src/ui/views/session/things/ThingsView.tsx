/**
 * Buzzar: the Things screen: objects you can spawn into worlds and use with your avatar. "Shortcuts" is a shelf of
 * the Things on number keys 1–0 (you choose which, and their order, by dragging or from their menus; utils/thingKeys), and "My Things" has the rest: the other stock
 * Things, then Things you've bookmarked (e.g. from a .glb posted in chat; kept in account data, see thingsMatrix.ts).
 */
import { ReactNode, useCallback, useEffect, useState } from "react";
import { ConnectDropTarget, useDrag, useDrop } from "react-dnd";
import classNames from "classnames";
import { useAtomValue } from "jotai";

import { useOpenDetails } from "../../../hooks/useOpenDetails";
import { Content } from "../../../atoms/content/Content";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { Icon } from "../../../atoms/icon/Icon";
import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { Dots } from "../../../atoms/loading/Dots";
import { Scroll } from "../../../atoms/scroll/Scroll";
import { DropdownMenuItem } from "../../../atoms/menu/DropdownMenuItem";
import { Window } from "../../components/window/Window";
import { TileFallback, WorldTile, WorldTileGrid } from "../../components/world-tile/WorldTile";
import { useMatrix } from "../../../hooks/useMatrix";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { useActionBar } from "../../../hooks/useActionBar";
import { getIdentifierColorNumber } from "../../../utils/avatar";
import { copyToClipboard } from "../../../utils/common";
import { getSessionAuth } from "../../../utils/avatarMatrix";
import {
  fetchThingCollection,
  removeFromThingCollection,
  SavedThing,
  STOCK_THINGS,
  StockThing,
  ThingCollection,
} from "../../../utils/thingsMatrix";
import { useThingPreview } from "../../../hooks/useThingPreview";
import { worldAtom } from "../../../state/world";
import { Thread } from "../../../../engine/module/module.common";
import {
  SpawnThingMessage,
  ThingKeys,
  thingKeyName,
  ThirdRoomMessageType,
} from "../../../../plugins/thirdroom/thirdroom.common";
import { thingKeysAtom } from "../../../state/thingKeys";
import { useSetThingKeys } from "../../../hooks/useThingKeys";
import { mapThing, moveMapped, unmapThing } from "../../../utils/thingKeys";
import BoxIC from "../../../../../res/ic/box-3d.svg";
import UploadIC from "../../../../../res/ic/upload.svg";
import { UploadThing } from "./UploadThing";
import { describeVariables, ThingCloneDialog } from "./ThingCloneDialog";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { thingClonesAtom } from "../../../state/thingClones";
import { sendCustomThings, useAllowedThings, useSetThingClones } from "../../../hooks/useThingClones";
import { ThingClone } from "../../../../plugins/thirdroom/thirdroom.common";
import "./ThingsView.css";

export function ThingsView() {
  const { session, platform, client } = useMatrix(true);
  const mainThread = useMainThreadContext();
  const { worldId, entered } = useAtomValue(worldAtom);
  const inWorld = entered && !!worldId;
  const allowed = useActionBar();
  const allowedThings = useAllowedThings();
  const clones = useAtomValue(thingClonesAtom) ?? [];
  const setThingClones = useSetThingClones();
  // Cloning or editing: the stock Thing, and the clone when editing one.
  const [cloning, setCloning] = useState<{ base: StockThing; existing?: ThingClone }>();
  const [collection, setCollection] = useState<ThingCollection>();
  const [error, setError] = useState<string>();

  const getAuth = useCallback(async () => {
    const auth = await getSessionAuth(platform, client.sessionId);
    if (!auth) throw new Error("Not signed in");
    return auth;
  }, [platform, client]);

  useEffect(() => {
    getAuth()
      .then((auth) => fetchThingCollection(auth, session.userId))
      .then(setCollection)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [getAuth, session]);

  // The game shows your own Things' names and pictures on the action bar.
  useEffect(() => {
    if (collection) sendCustomThings(mainThread, session, collection);
  }, [mainThread, session, collection]);

  const [uploadOpen, setUploadOpen] = useState(false);
  const keys = useAtomValue(thingKeysAtom);
  const setThingKeys = useSetThingKeys();
  const changeKeys = (next: ThingKeys) => {
    setError(undefined);
    setThingKeys(next).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  // Buzzar: your cloned Things show like stock ones, with their base's picture.
  const cloneThings: StockThing[] = clones.flatMap((clone) => {
    const base = STOCK_THINGS.find((t) => t.id === clone.base);
    return base
      ? [
          {
            id: clone.id,
            name: clone.name,
            preview: base.preview,
            description: describeVariables(clone.base, clone.variables),
          },
        ]
      : [];
  });
  // Your own Things (uploaded or bookmarked files) work like the rest: spawn them, put them on keys.
  const customThings: StockThing[] = (collection?.things ?? []).map((thing) => ({
    id: thing.url,
    name: thing.name || "Thing",
    preview: "",
    description: thing.added_ts ? `Saved ${new Date(thing.added_ts).toLocaleDateString()}` : "Saved Thing",
    custom: thing,
  }));
  const allThings = [...STOCK_THINGS, ...cloneThings, ...customThings];
  const cloneOf = (id: string) => clones.find((c) => c.id === id);
  // Things on keys (in key order) sit on the shelf; the rest are in My Things below.
  const mapped = (keys ?? [])
    .map((id, slot) => ({ thing: allThings.find((t) => t.id === id), slot }))
    .filter((entry): entry is { thing: StockThing; slot: number } => !!entry.thing);
  const unmapped = allThings.filter((thing) => !keys?.includes(thing.id));

  const saveClone = async (clone: ThingClone) => {
    const next = clones.some((c) => c.id === clone.id)
      ? clones.map((c) => (c.id === clone.id ? clone : c))
      : [...clones, clone];
    await setThingClones(next);
  };
  const deleteClone = (id: string) => {
    setError(undefined);
    if (keys?.includes(id)) changeKeys(unmapThing(keys, id));
    setThingClones(clones.filter((c) => c.id !== id)).catch((e) =>
      setError(e instanceof Error ? e.message : String(e))
    );
  };
  // Menu items for cloning a stock Thing, or editing/deleting a clone.
  const cloneMenu = (id: string) => {
    const clone = cloneOf(id);
    if (clone) {
      const base = STOCK_THINGS.find((t) => t.id === clone.base);
      return (
        <>
          {base && <DropdownMenuItem onSelect={() => setCloning({ base, existing: clone })}>Edit…</DropdownMenuItem>}
          {base && (
            <DropdownMenuItem
              onSelect={() => setCloning({ base, existing: { ...clone, id: "", name: `${clone.name} copy` } })}
            >
              Clone…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="danger" onSelect={() => deleteClone(id)}>
            Delete Clone
          </DropdownMenuItem>
        </>
      );
    }
    const custom = collection?.things.find((t) => t.url === id);
    if (custom) {
      return (
        <>
          <DropdownMenuItem onSelect={() => copyToClipboard(custom.url)}>Copy Thing Link</DropdownMenuItem>
          <DropdownMenuItem variant="danger" onSelect={() => unbookmark(custom.url)}>
            Remove Bookmark
          </DropdownMenuItem>
        </>
      );
    }
    const stock = STOCK_THINGS.find((t) => t.id === id);
    return stock ? <DropdownMenuItem onSelect={() => setCloning({ base: stock })}>Clone…</DropdownMenuItem> : null;
  };
  const freeKeys = (keys ?? []).flatMap((id, slot) => (id ? [] : [thingKeyName(slot)]));

  const spawnAction = (id: string) =>
    inWorld ? (
      allowed.some((item) => item.id === id) || allowedThings.includes(cloneOf(id)?.base ?? id) ? (
        <Button size="sm" onClick={() => spawn(id)}>
          Spawn
        </Button>
      ) : (
        <Button size="sm" fill="outline" disabled>
          Not Allowed Here
        </Button>
      )
    ) : undefined;

  const spawn = (id: string) =>
    mainThread.sendMessage<SpawnThingMessage>(Thread.Game, { type: ThirdRoomMessageType.SpawnThing, id });

  const unbookmark = async (url: string) => {
    setError(undefined);
    if (keys?.includes(url)) changeKeys(unmapThing(keys, url));
    try {
      setCollection(await removeFromThingCollection(await getAuth(), session.userId, url));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Window className="TileScreen">
      <UploadThing open={uploadOpen} onOpenChange={setUploadOpen} onSaved={setCollection} />
      <Dialog open={!!cloning} onOpenChange={(open) => !open && setCloning(undefined)}>
        {cloning && (
          <ThingCloneDialog
            base={cloning.base}
            // "Clone…" on a clone starts from its values as a new clone (empty id).
            existing={cloning.existing?.id ? cloning.existing : undefined}
            initial={cloning.existing && !cloning.existing.id ? cloning.existing : undefined}
            onSave={saveClone}
            requestClose={() => setCloning(undefined)}
          />
        )}
      </Dialog>
      <Content
        top={
          <Header
            left={<HeaderTitle icon={<Icon color="surface" className="shrink-0" src={BoxIC} />}>Things</HeaderTitle>}
            right={
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <Icon src={UploadIC} size="sm" color="on-primary" />
                Upload Thing
              </Button>
            }
          />
        }
      >
        <div className="TileScreen__bar flex items-center gap-sm">
          <Text variant="b3" color="surface-low">
            Things to spawn into worlds and play with: grab, carry and throw them.
            {inWorld ? "" : " Enter a world to spawn them."}
          </Text>
        </div>
        <Scroll type="hover">
          <div className="TileScreen__body flex flex-column gap-md">
            {error && (
              <Text className="TileScreen__note" variant="b3" color="danger">
                {error}
              </Text>
            )}
            <div className="flex flex-column gap-sm">
              <Text variant="b2" weight="semi-bold">
                Shortcuts
              </Text>
              <Text variant="b3" color="surface-low">
                Press a Thing’s number key in a world to spawn it. Drag Things here, along the row or back down to My
                Things, or use their menus.{keys && freeKeys.length > 0 ? ` Free keys: ${freeKeys.join(", ")}.` : ""}
              </Text>
              {keys && (
                <ShortcutShelf
                  keys={keys}
                  mapped={mapped}
                  spawnAction={spawnAction}
                  cloneMenu={cloneMenu}
                  onChangeKeys={changeKeys}
                />
              )}
            </div>
            <Text variant="b2" weight="semi-bold">
              My Things
            </Text>
            <MyThingsDropArea keys={keys} onChangeKeys={changeKeys}>
              {unmapped.map((thing) => (
                <DraggableThing key={thing.id} id={thing.id} onShelf={false}>
                  <StockThingTile
                    thing={thing}
                    keys={keys}
                    action={spawnAction(thing.id)}
                    extraMenu={cloneMenu(thing.id)}
                    onChangeKeys={changeKeys}
                  />
                </DraggableThing>
              ))}
            </MyThingsDropArea>
            {!collection
              ? !error && <Dots size="md" />
              : collection.things.length === 0 && (
                  <Text variant="b3" color="surface-low">
                    Things you bookmark show up here too: when someone posts a Thing (.glb) in chat, bookmark it from
                    its tile.
                  </Text>
                )}
          </div>
        </Scroll>
      </Content>
    </Window>
  );
}

/** Buzzar: the model file behind each stock Thing, for its details page (the balls are made in code: no file). */
const STOCK_THING_FILES: Record<string, string> = {
  "small-crate": "/gltf/sci_fi_crate.glb",
  "medium-crate": "/gltf/sci_fi_crate.glb",
  "large-crate": "/gltf/sci_fi_crate.glb",
  trampoline: "/gltf/things/trampoline.glb",
};

const THING_DRAG = "buzzar-thing";
interface ThingDragItem {
  id: string;
  onShelf: boolean;
}

/** Wraps a Thing's tile so it can be dragged onto, along or off the Shortcuts shelf. */
function DraggableThing({
  id,
  onShelf,
  dropRef,
  over,
  children,
}: {
  id: string;
  onShelf: boolean;
  dropRef?: ConnectDropTarget;
  over?: boolean;
  children: ReactNode;
}) {
  const [{ dragging }, drag] = useDrag(
    () => ({
      type: THING_DRAG,
      item: { id, onShelf } as ThingDragItem,
      collect: (m) => ({ dragging: m.isDragging() }),
    }),
    [id, onShelf]
  );
  return (
    <div
      ref={(el) => {
        drag(el);
        dropRef?.(el);
      }}
      className={classNames("ThingDrag", { "ThingDrag--dragging": dragging, "ThingDrag--over": over })}
    >
      {children}
    </div>
  );
}

/** One Thing on the shelf: drop another Thing on it to put that one here (this one and the rest move along). */
function ShelfThing({
  entry,
  index,
  keys,
  count,
  action,
  extraMenu,
  onChangeKeys,
}: {
  entry: { thing: StockThing; slot: number };
  index: number;
  keys: ThingKeys;
  count: number;
  action?: ReactNode;
  extraMenu?: ReactNode;
  onChangeKeys: (keys: ThingKeys) => void;
}) {
  const [{ over }, drop] = useDrop(
    () => ({
      accept: THING_DRAG,
      drop: (item: ThingDragItem) => {
        const next = moveMapped(keys, item.id, index);
        if (next) onChangeKeys(next);
      },
      canDrop: (item: ThingDragItem) => item.id !== entry.thing.id && (item.onShelf || keys.includes(null)),
      collect: (m) => ({ over: m.isOver() && m.canDrop() }),
    }),
    [keys, index, entry.thing.id, onChangeKeys]
  );
  const move = (to: number) => {
    const next = moveMapped(keys, entry.thing.id, to);
    if (next) onChangeKeys(next);
  };
  return (
    <DraggableThing id={entry.thing.id} onShelf dropRef={drop} over={over}>
      <StockThingTile
        thing={entry.thing}
        slot={entry.slot}
        action={action}
        menu={
          <>
            <DropdownMenuItem disabled={index === 0} onSelect={() => move(index - 1)}>
              Move Left
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === count - 1} onSelect={() => move(index + 1)}>
              Move Right
            </DropdownMenuItem>
            <DropdownMenuItem variant="danger" onSelect={() => onChangeKeys(unmapThing(keys, entry.thing.id))}>
              Remove from Shortcuts
            </DropdownMenuItem>
            {extraMenu}
          </>
        }
      />
    </DraggableThing>
  );
}

/** The Shortcuts shelf: Things on number keys, in key order. Dropping on its empty space adds to the end. */
function ShortcutShelf({
  keys,
  mapped,
  spawnAction,
  cloneMenu,
  onChangeKeys,
}: {
  keys: ThingKeys;
  mapped: { thing: StockThing; slot: number }[];
  spawnAction: (id: string) => ReactNode;
  cloneMenu: (id: string) => ReactNode;
  onChangeKeys: (keys: ThingKeys) => void;
}) {
  const [{ over }, drop] = useDrop(
    () => ({
      accept: THING_DRAG,
      drop: (item: ThingDragItem, monitor) => {
        if (monitor.didDrop()) return; // dropped on a Thing on the shelf
        const next = moveMapped(keys, item.id, mapped.length);
        if (next) onChangeKeys(next);
      },
      canDrop: (item: ThingDragItem) => item.onShelf || keys.includes(null),
      collect: (m) => ({ over: m.isOver({ shallow: true }) && m.canDrop() }),
    }),
    [keys, mapped.length, onChangeKeys]
  );
  return (
    <div ref={drop} className={classNames("ThingShelf", { "ThingShelf--over": over })}>
      {mapped.length === 0 ? (
        <Text variant="b3" color="surface-low">
          No shortcuts yet: drag a Thing here, or choose Add to Shortcuts from its menu.
        </Text>
      ) : (
        <WorldTileGrid tall>
          {mapped.map((entry, index) => (
            <ShelfThing
              key={entry.thing.id}
              entry={entry}
              index={index}
              keys={keys}
              count={mapped.length}
              action={spawnAction(entry.thing.id)}
              extraMenu={cloneMenu(entry.thing.id)}
              onChangeKeys={onChangeKeys}
            />
          ))}
        </WorldTileGrid>
      )}
    </div>
  );
}

/** My Things: dropping a Thing from the shelf here removes it from Shortcuts. */
function MyThingsDropArea({
  keys,
  onChangeKeys,
  children,
}: {
  keys?: ThingKeys;
  onChangeKeys: (keys: ThingKeys) => void;
  children: ReactNode;
}) {
  const [{ over }, drop] = useDrop(
    () => ({
      accept: THING_DRAG,
      canDrop: (item: ThingDragItem) => item.onShelf && !!keys,
      drop: (item: ThingDragItem) => {
        if (keys) onChangeKeys(unmapThing(keys, item.id));
      },
      collect: (m) => ({ over: m.isOver() && m.canDrop() }),
    }),
    [keys, onChangeKeys]
  );
  return (
    <div ref={drop} className={classNames("ThingShelf", { "ThingShelf--over": over })}>
      <WorldTileGrid tall>{children}</WorldTileGrid>
    </div>
  );
}

interface ThingTileProps {
  thing: StockThing;
  slot?: number;
  keys?: ThingKeys;
  action?: ReactNode;
  menu?: ReactNode;
  extraMenu?: ReactNode;
  onChangeKeys?: (keys: ThingKeys) => void;
}

/** A Thing's tile: a built-in one's picture, or your own Thing's preview (rendered from its file if it has none). */
function StockThingTile(props: ThingTileProps) {
  return props.thing.custom ? (
    <SavedThingTile {...props} saved={props.thing.custom} />
  ) : (
    <BuiltinThingTile {...props} />
  );
}

/** The "Add to Shortcuts" item, or the shelf's own menu. */
function tileMenu({ thing, keys, menu, extraMenu, onChangeKeys }: ThingTileProps) {
  const free = keys ? keys.indexOf(null) : -1;
  return (
    menu ?? (
      <>
        {keys && onChangeKeys && (
          <DropdownMenuItem disabled={free === -1} onSelect={() => onChangeKeys(mapThing(keys, thing.id, free))}>
            {free === -1 ? "Shortcuts Full" : `Add to Shortcuts (Key ${thingKeyName(free)})`}
          </DropdownMenuItem>
        )}
        {extraMenu}
      </>
    )
  );
}

/** A stock Thing's tile: its key badge when it's a shortcut, and Add to Shortcuts (or the shelf's own menu). */
function BuiltinThingTile({
  thing,
  slot,
  keys,
  action,
  menu,
  extraMenu,
  onChangeKeys,
}: {
  thing: StockThing;
  slot?: number;
  keys?: ThingKeys;
  action?: ReactNode;
  menu?: ReactNode;
  extraMenu?: ReactNode;
  onChangeKeys?: (keys: ThingKeys) => void;
}) {
  const free = keys ? keys.indexOf(null) : -1;
  const openDetails = useOpenDetails();
  return (
    <WorldTile
      shape="tall"
      imageSrc={thing.preview}
      title={thing.name}
      onTitleClick={() =>
        openDetails({
          kind: "thing",
          name: thing.name,
          url: STOCK_THING_FILES[thing.id],
          previewUrl: thing.preview,
          description: thing.description,
          stockId: thing.id,
        })
      }
      badge={slot !== undefined ? `Key ${thingKeyName(slot)}` : undefined}
      subtitle={
        <Text variant="b3" color="surface-low">
          {thing.description}
        </Text>
      }
      action={action}
      menu={
        menu ?? (
          <>
            {keys && onChangeKeys && (
              <DropdownMenuItem disabled={free === -1} onSelect={() => onChangeKeys(mapThing(keys, thing.id, free))}>
                {free === -1 ? "Shortcuts Full" : `Add to Shortcuts (Key ${thingKeyName(free)})`}
              </DropdownMenuItem>
            )}
            {extraMenu}
          </>
        )
      }
    />
  );
}

/** One of your own Things: its preview (rendered from the file when it has none). */
function SavedThingTile(props: ThingTileProps & { saved: SavedThing }) {
  const { saved, thing, slot, action } = props;
  const { src, rendered, loading } = useThingPreview(saved.url, saved.preview_url);
  const openDetails = useOpenDetails();
  return (
    <WorldTile
      shape="tall"
      imageSrc={src}
      fallback={
        loading ? (
          <div className="WorldTile__fallback flex flex-column items-center justify-center gap-xs">
            <Dots size="md" />
            <Text variant="b3" color="surface-low">
              Making a preview…
            </Text>
          </div>
        ) : (
          <TileFallback name={thing.name} color={`var(--usercolor${getIdentifierColorNumber(saved.url)})`} />
        )
      }
      title={thing.name}
      onTitleClick={() =>
        openDetails({ kind: "thing", name: thing.name, url: saved.url, previewUrl: saved.preview_url ?? rendered })
      }
      badge={slot !== undefined ? `Key ${thingKeyName(slot)}` : undefined}
      subtitle={
        <Text variant="b3" color="surface-low">
          {thing.description}
        </Text>
      }
      action={action}
      menu={tileMenu(props)}
    />
  );
}
