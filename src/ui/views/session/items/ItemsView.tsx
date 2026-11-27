/**
 * Buzzar: the Items screen: objects you can spawn into worlds and use with your avatar. "Shortcuts" is a shelf of
 * the Items on number keys 1–0 (you choose which, and their order, by dragging or from their menus; utils/itemKeys), and "My Items" has the rest: the other stock
 * Items, then Items you've bookmarked (e.g. from a .glb posted in chat; kept in account data, see itemsMatrix.ts).
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
  fetchItemCollection,
  removeFromItemCollection,
  SavedItem,
  STOCK_ITEMS,
  StockItem,
  ItemCollection,
} from "../../../utils/itemsMatrix";
import { useItemPreview } from "../../../hooks/useItemPreview";
import { worldAtom } from "../../../state/world";
import { Thread } from "../../../../engine/module/module.common";
import {
  SpawnItemMessage,
  ItemKeys,
  itemKeyName,
  ThirdRoomMessageType,
} from "../../../../plugins/thirdroom/thirdroom.common";
import { itemKeysAtom } from "../../../state/itemKeys";
import { useSetItemKeys } from "../../../hooks/useItemKeys";
import { mapItem, moveMapped, unmapItem } from "../../../utils/itemKeys";
import BoxIC from "../../../../../res/ic/box-3d.svg";
import UploadIC from "../../../../../res/ic/upload.svg";
import { UploadItem } from "./UploadItem";
import { describeVariables, ItemCloneDialog } from "./ItemCloneDialog";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { itemClonesAtom } from "../../../state/itemClones";
import { sendCustomItems, useAllowedItems, useSetItemClones } from "../../../hooks/useItemClones";
import { ItemClone } from "../../../../plugins/thirdroom/thirdroom.common";
import "./ItemsView.css";

export function ItemsView() {
  const { session, platform, client } = useMatrix(true);
  const mainThread = useMainThreadContext();
  const { worldId, entered } = useAtomValue(worldAtom);
  const inWorld = entered && !!worldId;
  const allowed = useActionBar();
  const allowedItems = useAllowedItems();
  const clones = useAtomValue(itemClonesAtom) ?? [];
  const setItemClones = useSetItemClones();
  // Cloning or editing: the stock Item, and the clone when editing one.
  const [cloning, setCloning] = useState<{ base: StockItem; existing?: ItemClone }>();
  const [collection, setCollection] = useState<ItemCollection>();
  const [error, setError] = useState<string>();

  const getAuth = useCallback(async () => {
    const auth = await getSessionAuth(platform, client.sessionId);
    if (!auth) throw new Error("Not signed in");
    return auth;
  }, [platform, client]);

  useEffect(() => {
    getAuth()
      .then((auth) => fetchItemCollection(auth, session.userId))
      .then(setCollection)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [getAuth, session]);

  // The game shows your own Items' names and pictures on the action bar.
  useEffect(() => {
    if (collection) sendCustomItems(mainThread, session, collection);
  }, [mainThread, session, collection]);

  const [uploadOpen, setUploadOpen] = useState(false);
  const keys = useAtomValue(itemKeysAtom);
  const setItemKeys = useSetItemKeys();
  const changeKeys = (next: ItemKeys) => {
    setError(undefined);
    setItemKeys(next).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  // Buzzar: your cloned Items show like stock ones, with their base's picture.
  const cloneItems: StockItem[] = clones.flatMap((clone) => {
    const base = STOCK_ITEMS.find((t) => t.id === clone.base);
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
  // Your own Items (uploaded or bookmarked files) work like the rest: spawn them, put them on keys.
  const customItems: StockItem[] = (collection?.items ?? []).map((item) => ({
    id: item.url,
    name: item.name || "Item",
    preview: "",
    description: item.added_ts ? `Saved ${new Date(item.added_ts).toLocaleDateString()}` : "Saved Item",
    custom: item,
  }));
  const allItems = [...STOCK_ITEMS, ...cloneItems, ...customItems];
  const cloneOf = (id: string) => clones.find((c) => c.id === id);
  // Items on keys (in key order) sit on the shelf; the rest are in My Items below.
  const mapped = (keys ?? [])
    .map((id, slot) => ({ item: allItems.find((t) => t.id === id), slot }))
    .filter((entry): entry is { item: StockItem; slot: number } => !!entry.item);
  const unmapped = allItems.filter((item) => !keys?.includes(item.id));

  const saveClone = async (clone: ItemClone) => {
    const next = clones.some((c) => c.id === clone.id)
      ? clones.map((c) => (c.id === clone.id ? clone : c))
      : [...clones, clone];
    await setItemClones(next);
  };
  const deleteClone = (id: string) => {
    setError(undefined);
    if (keys?.includes(id)) changeKeys(unmapItem(keys, id));
    setItemClones(clones.filter((c) => c.id !== id)).catch((e) =>
      setError(e instanceof Error ? e.message : String(e))
    );
  };
  // Menu items for cloning a stock Item, or editing/deleting a clone.
  const cloneMenu = (id: string) => {
    const clone = cloneOf(id);
    if (clone) {
      const base = STOCK_ITEMS.find((t) => t.id === clone.base);
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
    const custom = collection?.items.find((t) => t.url === id);
    if (custom) {
      return (
        <>
          <DropdownMenuItem onSelect={() => copyToClipboard(custom.url)}>Copy Item Link</DropdownMenuItem>
          <DropdownMenuItem variant="danger" onSelect={() => unbookmark(custom.url)}>
            Remove Bookmark
          </DropdownMenuItem>
        </>
      );
    }
    const stock = STOCK_ITEMS.find((t) => t.id === id);
    return stock ? <DropdownMenuItem onSelect={() => setCloning({ base: stock })}>Clone…</DropdownMenuItem> : null;
  };
  const freeKeys = (keys ?? []).flatMap((id, slot) => (id ? [] : [itemKeyName(slot)]));

  const spawnAction = (id: string) =>
    inWorld ? (
      allowed.some((item) => item.id === id) || allowedItems.includes(cloneOf(id)?.base ?? id) ? (
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
    mainThread.sendMessage<SpawnItemMessage>(Thread.Game, { type: ThirdRoomMessageType.SpawnItem, id });

  const unbookmark = async (url: string) => {
    setError(undefined);
    if (keys?.includes(url)) changeKeys(unmapItem(keys, url));
    try {
      setCollection(await removeFromItemCollection(await getAuth(), session.userId, url));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Window className="TileScreen">
      <UploadItem open={uploadOpen} onOpenChange={setUploadOpen} onSaved={setCollection} />
      <Dialog open={!!cloning} onOpenChange={(open) => !open && setCloning(undefined)}>
        {cloning && (
          <ItemCloneDialog
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
            left={<HeaderTitle icon={<Icon color="surface" className="shrink-0" src={BoxIC} />}>Items</HeaderTitle>}
            right={
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <Icon src={UploadIC} size="sm" color="on-primary" />
                Upload Item
              </Button>
            }
          />
        }
      >
        <div className="TileScreen__bar flex items-center gap-sm">
          <Text variant="b3" color="surface-low">
            Items to spawn into worlds and play with: grab, carry and throw them.
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
                Press an Item’s number key in a world to spawn it. Drag Items here, along the row or back down to My
                Items, or use their menus.{keys && freeKeys.length > 0 ? ` Free keys: ${freeKeys.join(", ")}.` : ""}
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
              My Items
            </Text>
            <MyItemsDropArea keys={keys} onChangeKeys={changeKeys}>
              {unmapped.map((item) => (
                <DraggableItem key={item.id} id={item.id} onShelf={false}>
                  <StockItemTile
                    item={item}
                    keys={keys}
                    action={spawnAction(item.id)}
                    extraMenu={cloneMenu(item.id)}
                    onChangeKeys={changeKeys}
                  />
                </DraggableItem>
              ))}
            </MyItemsDropArea>
            {!collection
              ? !error && <Dots size="md" />
              : collection.items.length === 0 && (
                  <Text variant="b3" color="surface-low">
                    Items you bookmark show up here too: when someone posts an Item (.glb) in chat, bookmark it from
                    its tile.
                  </Text>
                )}
          </div>
        </Scroll>
      </Content>
    </Window>
  );
}

/** Buzzar: the model file behind each stock Item, for its details page (the balls are made in code: no file). */
const STOCK_ITEM_FILES: Record<string, string> = {
  "small-crate": "/gltf/sci_fi_crate.glb",
  "medium-crate": "/gltf/sci_fi_crate.glb",
  "large-crate": "/gltf/sci_fi_crate.glb",
  trampoline: "/gltf/items/trampoline.glb",
};

const ITEM_DRAG = "buzzar-item";
interface ItemDragItem {
  id: string;
  onShelf: boolean;
}

/** Wraps an Item's tile so it can be dragged onto, along or off the Shortcuts shelf. */
function DraggableItem({
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
      type: ITEM_DRAG,
      item: { id, onShelf } as ItemDragItem,
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
      className={classNames("ItemDrag", { "ItemDrag--dragging": dragging, "ItemDrag--over": over })}
    >
      {children}
    </div>
  );
}

/** One Item on the shelf: drop another Item on it to put that one here (this one and the rest move along). */
function ShelfItem({
  entry,
  index,
  keys,
  count,
  action,
  extraMenu,
  onChangeKeys,
}: {
  entry: { item: StockItem; slot: number };
  index: number;
  keys: ItemKeys;
  count: number;
  action?: ReactNode;
  extraMenu?: ReactNode;
  onChangeKeys: (keys: ItemKeys) => void;
}) {
  const [{ over }, drop] = useDrop(
    () => ({
      accept: ITEM_DRAG,
      drop: (item: ItemDragItem) => {
        const next = moveMapped(keys, item.id, index);
        if (next) onChangeKeys(next);
      },
      canDrop: (item: ItemDragItem) => item.id !== entry.item.id && (item.onShelf || keys.includes(null)),
      collect: (m) => ({ over: m.isOver() && m.canDrop() }),
    }),
    [keys, index, entry.item.id, onChangeKeys]
  );
  const move = (to: number) => {
    const next = moveMapped(keys, entry.item.id, to);
    if (next) onChangeKeys(next);
  };
  return (
    <DraggableItem id={entry.item.id} onShelf dropRef={drop} over={over}>
      <StockItemTile
        item={entry.item}
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
            <DropdownMenuItem variant="danger" onSelect={() => onChangeKeys(unmapItem(keys, entry.item.id))}>
              Remove from Shortcuts
            </DropdownMenuItem>
            {extraMenu}
          </>
        }
      />
    </DraggableItem>
  );
}

/** The Shortcuts shelf: Items on number keys, in key order. Dropping on its empty space adds to the end. */
function ShortcutShelf({
  keys,
  mapped,
  spawnAction,
  cloneMenu,
  onChangeKeys,
}: {
  keys: ItemKeys;
  mapped: { item: StockItem; slot: number }[];
  spawnAction: (id: string) => ReactNode;
  cloneMenu: (id: string) => ReactNode;
  onChangeKeys: (keys: ItemKeys) => void;
}) {
  const [{ over }, drop] = useDrop(
    () => ({
      accept: ITEM_DRAG,
      drop: (item: ItemDragItem, monitor) => {
        if (monitor.didDrop()) return; // dropped on an Item on the shelf
        const next = moveMapped(keys, item.id, mapped.length);
        if (next) onChangeKeys(next);
      },
      canDrop: (item: ItemDragItem) => item.onShelf || keys.includes(null),
      collect: (m) => ({ over: m.isOver({ shallow: true }) && m.canDrop() }),
    }),
    [keys, mapped.length, onChangeKeys]
  );
  return (
    <div ref={drop} className={classNames("ItemShelf", { "ItemShelf--over": over })}>
      {mapped.length === 0 ? (
        <Text variant="b3" color="surface-low">
          No shortcuts yet: drag an Item here, or choose Add to Shortcuts from its menu.
        </Text>
      ) : (
        <WorldTileGrid tall>
          {mapped.map((entry, index) => (
            <ShelfItem
              key={entry.item.id}
              entry={entry}
              index={index}
              keys={keys}
              count={mapped.length}
              action={spawnAction(entry.item.id)}
              extraMenu={cloneMenu(entry.item.id)}
              onChangeKeys={onChangeKeys}
            />
          ))}
        </WorldTileGrid>
      )}
    </div>
  );
}

/** My Items: dropping an Item from the shelf here removes it from Shortcuts. */
function MyItemsDropArea({
  keys,
  onChangeKeys,
  children,
}: {
  keys?: ItemKeys;
  onChangeKeys: (keys: ItemKeys) => void;
  children: ReactNode;
}) {
  const [{ over }, drop] = useDrop(
    () => ({
      accept: ITEM_DRAG,
      canDrop: (item: ItemDragItem) => item.onShelf && !!keys,
      drop: (item: ItemDragItem) => {
        if (keys) onChangeKeys(unmapItem(keys, item.id));
      },
      collect: (m) => ({ over: m.isOver() && m.canDrop() }),
    }),
    [keys, onChangeKeys]
  );
  return (
    <div ref={drop} className={classNames("ItemShelf", { "ItemShelf--over": over })}>
      <WorldTileGrid tall>{children}</WorldTileGrid>
    </div>
  );
}

interface ItemTileProps {
  item: StockItem;
  slot?: number;
  keys?: ItemKeys;
  action?: ReactNode;
  menu?: ReactNode;
  extraMenu?: ReactNode;
  onChangeKeys?: (keys: ItemKeys) => void;
}

/** An Item's tile: a built-in one's picture, or your own Item's preview (rendered from its file if it has none). */
function StockItemTile(props: ItemTileProps) {
  return props.item.custom ? (
    <SavedItemTile {...props} saved={props.item.custom} />
  ) : (
    <BuiltinItemTile {...props} />
  );
}

/** The "Add to Shortcuts" item, or the shelf's own menu. */
function tileMenu({ item, keys, menu, extraMenu, onChangeKeys }: ItemTileProps) {
  const free = keys ? keys.indexOf(null) : -1;
  return (
    menu ?? (
      <>
        {keys && onChangeKeys && (
          <DropdownMenuItem disabled={free === -1} onSelect={() => onChangeKeys(mapItem(keys, item.id, free))}>
            {free === -1 ? "Shortcuts Full" : `Add to Shortcuts (Key ${itemKeyName(free)})`}
          </DropdownMenuItem>
        )}
        {extraMenu}
      </>
    )
  );
}

/** A stock Item's tile: its key badge when it's a shortcut, and Add to Shortcuts (or the shelf's own menu). */
function BuiltinItemTile({
  item,
  slot,
  keys,
  action,
  menu,
  extraMenu,
  onChangeKeys,
}: {
  item: StockItem;
  slot?: number;
  keys?: ItemKeys;
  action?: ReactNode;
  menu?: ReactNode;
  extraMenu?: ReactNode;
  onChangeKeys?: (keys: ItemKeys) => void;
}) {
  const free = keys ? keys.indexOf(null) : -1;
  const openDetails = useOpenDetails();
  return (
    <WorldTile
      shape="tall"
      imageSrc={item.preview}
      title={item.name}
      onTitleClick={() =>
        openDetails({
          kind: "item",
          name: item.name,
          url: STOCK_ITEM_FILES[item.id],
          previewUrl: item.preview,
          description: item.description,
          stockId: item.id,
        })
      }
      badge={slot !== undefined ? `Key ${itemKeyName(slot)}` : undefined}
      subtitle={
        <Text variant="b3" color="surface-low">
          {item.description}
        </Text>
      }
      action={action}
      menu={
        menu ?? (
          <>
            {keys && onChangeKeys && (
              <DropdownMenuItem disabled={free === -1} onSelect={() => onChangeKeys(mapItem(keys, item.id, free))}>
                {free === -1 ? "Shortcuts Full" : `Add to Shortcuts (Key ${itemKeyName(free)})`}
              </DropdownMenuItem>
            )}
            {extraMenu}
          </>
        )
      }
    />
  );
}

/** One of your own Items: its preview (rendered from the file when it has none). */
function SavedItemTile(props: ItemTileProps & { saved: SavedItem }) {
  const { saved, item, slot, action } = props;
  const { src, rendered, loading } = useItemPreview(saved.url, saved.preview_url);
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
          <TileFallback name={item.name} color={`var(--usercolor${getIdentifierColorNumber(saved.url)})`} />
        )
      }
      title={item.name}
      onTitleClick={() =>
        openDetails({ kind: "item", name: item.name, url: saved.url, previewUrl: saved.preview_url ?? rendered })
      }
      badge={slot !== undefined ? `Key ${itemKeyName(slot)}` : undefined}
      subtitle={
        <Text variant="b3" color="surface-low">
          {item.description}
        </Text>
      }
      action={action}
      menu={tileMenu(props)}
    />
  );
}
