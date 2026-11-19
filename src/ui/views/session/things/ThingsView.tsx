/**
 * Buzzar: the Things screen: objects you can spawn into worlds and use with your avatar. "Shortcuts" is a shelf of
 * the Things on number keys 1–0 (you choose which, and their order, by dragging or from their menus; utils/thingKeys), and "My Things" has the rest: the other stock
 * Things, then Things you've bookmarked (e.g. from a .glb posted in chat; kept in account data, see thingsMatrix.ts).
 */
import { ReactNode, useCallback, useEffect, useState } from "react";
import { ConnectDropTarget, useDrag, useDrop } from "react-dnd";
import classNames from "classnames";
import { useAtomValue } from "jotai";

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
import { useHydrogen } from "../../../hooks/useHydrogen";
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
import { renderAvatarPreviewFromUrl } from "../../../utils/avatarPreview";
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
import "./ThingsView.css";

export function ThingsView() {
  const { session, platform, client } = useHydrogen(true);
  const mainThread = useMainThreadContext();
  const { worldId, entered } = useAtomValue(worldAtom);
  const inWorld = entered && !!worldId;
  const allowed = useActionBar();
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

  const keys = useAtomValue(thingKeysAtom);
  const setThingKeys = useSetThingKeys();
  const changeKeys = (next: ThingKeys) => {
    setError(undefined);
    setThingKeys(next).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  // Things on keys (in key order) sit on the shelf; the rest are in My Things below.
  const mapped = (keys ?? [])
    .map((id, slot) => ({ thing: STOCK_THINGS.find((t) => t.id === id), slot }))
    .filter((entry): entry is { thing: StockThing; slot: number } => !!entry.thing);
  const unmapped = STOCK_THINGS.filter((thing) => !keys?.includes(thing.id));
  const freeKeys = (keys ?? []).flatMap((id, slot) => (id ? [] : [thingKeyName(slot)]));

  const spawnAction = (id: string) =>
    inWorld ? (
      allowed.some((item) => item.id === id) ? (
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
    try {
      setCollection(await removeFromThingCollection(await getAuth(), session.userId, url));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Window className="TileScreen">
      <Content
        top={
          <Header
            left={<HeaderTitle icon={<Icon color="surface" className="shrink-0" src={BoxIC} />}>Things</HeaderTitle>}
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
                <ShortcutShelf keys={keys} mapped={mapped} spawnAction={spawnAction} onChangeKeys={changeKeys} />
              )}
            </div>
            <Text variant="b2" weight="semi-bold">
              My Things
            </Text>
            <MyThingsDropArea keys={keys} onChangeKeys={changeKeys}>
              {unmapped.map((thing) => (
                <DraggableThing key={thing.id} id={thing.id} onShelf={false}>
                  <StockThingTile thing={thing} keys={keys} action={spawnAction(thing.id)} onChangeKeys={changeKeys} />
                </DraggableThing>
              ))}
              {collection?.things.map((thing) => (
                <SavedThingTile key={thing.url} thing={thing} onRemove={() => unbookmark(thing.url)} />
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
  onChangeKeys,
}: {
  entry: { thing: StockThing; slot: number };
  index: number;
  keys: ThingKeys;
  count: number;
  action?: ReactNode;
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
  onChangeKeys,
}: {
  keys: ThingKeys;
  mapped: { thing: StockThing; slot: number }[];
  spawnAction: (id: string) => ReactNode;
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

/** A stock Thing's tile: its key badge when it's a shortcut, and Add to Shortcuts (or the shelf's own menu). */
function StockThingTile({
  thing,
  slot,
  keys,
  action,
  menu,
  onChangeKeys,
}: {
  thing: StockThing;
  slot?: number;
  keys?: ThingKeys;
  action?: ReactNode;
  menu?: ReactNode;
  onChangeKeys?: (keys: ThingKeys) => void;
}) {
  const free = keys ? keys.indexOf(null) : -1;
  return (
    <WorldTile
      shape="tall"
      imageSrc={thing.preview}
      title={thing.name}
      badge={slot !== undefined ? `Key ${thingKeyName(slot)}` : undefined}
      subtitle={
        <Text variant="b3" color="surface-low">
          {thing.description}
        </Text>
      }
      action={action}
      menu={
        menu ??
        (keys && onChangeKeys && (
          <DropdownMenuItem disabled={free === -1} onSelect={() => onChangeKeys(mapThing(keys, thing.id, free))}>
            {free === -1 ? "Shortcuts Full" : `Add to Shortcuts (Key ${thingKeyName(free)})`}
          </DropdownMenuItem>
        ))
      }
    />
  );
}

/** A bookmarked Thing: its preview (rendered from the file when it has none). */
function SavedThingTile({ thing, onRemove }: { thing: SavedThing; onRemove: () => void }) {
  const { session } = useHydrogen(true);
  const [rendered, setRendered] = useState<string>();
  const [loading, setLoading] = useState(false);
  const preview = thing.preview_url
    ? session.mediaRepository.mxcUrlThumbnail(thing.preview_url, 360, 480, "scale") ?? undefined
    : undefined;

  useEffect(() => {
    if (thing.preview_url) return;
    const httpUrl = session.mediaRepository.mxcUrl(thing.url);
    if (!httpUrl) return;
    let objectUrl: string | undefined;
    let cancelled = false;
    setLoading(true);
    renderAvatarPreviewFromUrl(thing.url, httpUrl, "thing")
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setRendered(objectUrl);
      })
      .catch((e) => console.warn("Couldn't render a Thing preview", e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [thing.url, thing.preview_url, session]);

  const name = thing.name || "Thing";
  return (
    <WorldTile
      shape="tall"
      imageSrc={preview ?? rendered}
      fallback={
        loading ? (
          <div className="WorldTile__fallback flex flex-column items-center justify-center gap-xs">
            <Dots size="md" />
            <Text variant="b3" color="surface-low">
              Making a preview…
            </Text>
          </div>
        ) : (
          <TileFallback name={name} color={`var(--usercolor${getIdentifierColorNumber(thing.url)})`} />
        )
      }
      title={name}
      subtitle={
        <Text variant="b3" color="surface-low">
          {thing.added_ts ? `Saved ${new Date(thing.added_ts).toLocaleDateString()}` : "Saved Thing"} · spawning your
          own Things is coming soon
        </Text>
      }
      menu={
        <>
          <DropdownMenuItem onSelect={() => copyToClipboard(thing.url)}>Copy Thing Link</DropdownMenuItem>
          <DropdownMenuItem variant="danger" onSelect={onRemove}>
            Remove Bookmark
          </DropdownMenuItem>
        </>
      }
    />
  );
}
