/**
 * Buzzar: World Settings → Items: which Items people may spawn in this world (software.haven.world.rules →
 * `objects`). Either a block list (everything except the Items marked blocked) or an allow list (nothing except
 * the Items marked allowed), plus behaviours turned off for every Item (e.g. trampolines). Custom Items are
 * listed by their exact file, so a world can allow its own Items and nothing else. Every visitor's client enforces
 * it (engine/network/spawnRules.game.ts).
 */
import { useEffect, useState } from "react";

import { Button } from "../../../atoms/button/Button";
import { Checkbox } from "../../../atoms/checkbox/Checkbox";
import { Input } from "../../../atoms/input/Input";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { Dots } from "../../../atoms/loading/Dots";
import { DropdownMenuItem } from "../../../atoms/menu/DropdownMenuItem";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { SelectInput } from "../../components/property-panel/SelectInput";
import { TileFallback, WorldTile, WorldTileGrid } from "../../components/world-tile/WorldTile";
import { AlertDialog } from "../dialogs/AlertDialog";
import { useMatrix } from "../../../hooks/useMatrix";
import { useItemPreview } from "../../../hooks/useItemPreview";
import { getIdentifierColorNumber } from "../../../utils/avatar";
import { getSessionAuth } from "../../../utils/avatarMatrix";
import { fetchItemCollection, SavedItem, STOCK_ITEMS } from "../../../utils/itemsMatrix";
import {
  isSpawnAllowed,
  isItemId,
  ListedItem,
  MAX_LISTED_ITEMS,
  SpawnRules,
  itemBehaviours,
} from "../../../../engine/network/spawnRules.common";

export interface ItemRulesDraft {
  default: "allow" | "block";
  items: ListedItem[];
  blockedBehaviours: string[];
}

const BEHAVIOURS: { id: string; label: string; short: string }[] = [
  { id: "HAVEN_trampoline", label: "Trampolines and other bouncy Items", short: "bouncy Items are off" },
];

const MODES = [
  { value: "allow" as const, label: "Allow every Item except the ones blocked below" },
  { value: "block" as const, label: "Block every Item except the ones allowed below" },
];

function toRules(draft: ItemRulesDraft): SpawnRules {
  return {
    default: draft.default,
    items: Object.fromEntries(draft.items.map((t) => [t.id, t.allow])),
    blockedBehaviours: draft.blockedBehaviours,
  };
}

interface Props {
  value: ItemRulesDraft;
  onChange: (value: ItemRulesDraft) => void;
  disabled?: boolean;
}

export function WorldItemRules({ value, onChange, disabled }: Props) {
  const [adding, setAdding] = useState(false);
  const rules = toRules(value);
  const custom = value.items.filter((t) => !STOCK_ITEMS.some((s) => s.id === t.id));

  /** Flips an Item. Stock Items leave the list when they're back to the default; custom ones stay listed. */
  const toggle = (id: string, extra?: Partial<ListedItem>) => {
    const allow = !(rules.items[id] ?? rules.default !== "block");
    const isStock = STOCK_ITEMS.some((s) => s.id === id);
    const existing = value.items.find((t) => t.id === id);
    let items: ListedItem[];
    if (isStock && allow === (value.default !== "block")) items = value.items.filter((t) => t.id !== id);
    else if (existing) items = value.items.map((t) => (t.id === id ? { ...t, allow } : t));
    else items = [...value.items, { id, allow, ...extra }];
    onChange({ ...value, items });
  };

  const add = (item: ListedItem) => {
    if (value.items.some((t) => t.id === item.id)) return;
    onChange({ ...value, items: [...value.items, item].slice(0, MAX_LISTED_ITEMS) });
  };

  const remove = (id: string) => onChange({ ...value, items: value.items.filter((t) => t.id !== id) });

  const behaviourBlock = (id: string) =>
    BEHAVIOURS.find((b) => value.blockedBehaviours.includes(b.id) && itemBehaviours(id).includes(b.id));

  const tile = (id: string, name: string, image: { src?: string; loading?: boolean }, removable: boolean) => {
    const allowed = isSpawnAllowed(rules, id);
    const blockedBy = behaviourBlock(id);
    return (
      <WorldTile
        key={id}
        shape="tall"
        imageSrc={image.src}
        fallback={
          image.loading ? (
            <div className="WorldTile__fallback flex items-center justify-center">
              <Dots size="md" />
            </div>
          ) : (
            <TileFallback name={name} color={`var(--usercolor${getIdentifierColorNumber(id)})`} />
          )
        }
        title={name}
        subtitle={
          <Text variant="b3" color={allowed ? "surface-low" : "danger"} weight="semi-bold">
            {allowed ? "Allowed" : blockedBy ? `Blocked: ${blockedBy.short}` : "Blocked"}
          </Text>
        }
        action={
          <Button
            size="sm"
            fill="outline"
            variant={allowed ? "danger" : "primary"}
            disabled={disabled || !!blockedBy}
            onClick={() => toggle(id)}
          >
            {allowed ? "Block" : "Allow"}
          </Button>
        }
        menu={
          removable && !disabled ? (
            <DropdownMenuItem variant="danger" onSelect={() => remove(id)}>
              Remove From List
            </DropdownMenuItem>
          ) : undefined
        }
      />
    );
  };

  return (
    <>
      <SettingTile label={<Label>Items People Can Spawn</Label>}>
        <SelectInput
          options={MODES}
          value={value.default}
          disabled={disabled}
          onChange={(mode) => onChange({ ...value, default: mode })}
        />
        <Text variant="b3" color="surface-low">
          {value.default === "block"
            ? "Only the Items marked Allowed can be spawned here. Use this to allow just your own Items."
            : "Any Item can be spawned here, including people's own, except the ones marked Blocked."}
        </Text>
      </SettingTile>
      <SettingTile label={<Label>Behaviours</Label>}>
        {BEHAVIOURS.map((b) => (
          <label key={b.id} className="flex items-center gap-xxs">
            <Checkbox
              checked={!value.blockedBehaviours.includes(b.id)}
              disabled={disabled}
              onCheckedChange={(on) =>
                onChange({
                  ...value,
                  blockedBehaviours: on
                    ? value.blockedBehaviours.filter((x) => x !== b.id)
                    : [...value.blockedBehaviours, b.id],
                })
              }
            />
            <Text variant="b2">{b.label}</Text>
          </label>
        ))}
        <Text variant="b3" color="surface-low">
          Unchecked behaviours are off for every spawned Item that has them, whatever the list says, so nobody gets
          round the rule with an Item of their own.
        </Text>
      </SettingTile>
      <SettingTile label={<Label>Stock Items</Label>}>
        <WorldTileGrid tall>
          {STOCK_ITEMS.map((item) => tile(item.id, item.name, { src: item.preview }, false))}
        </WorldTileGrid>
      </SettingTile>
      <SettingTile label={<Label>Other Items</Label>}>
        {custom.length > 0 && (
          <WorldTileGrid tall>
            {custom.map((item) => (
              <CustomItemTile key={item.id} item={item} render={tile} />
            ))}
          </WorldTileGrid>
        )}
        <Text variant="b3" color="surface-low">
          {custom.length === 0 &&
            (value.default === "block"
              ? "None yet. Add the Items you've made for this world to allow them. "
              : "None yet. Add an Item to block that exact file. ")}
          Each one is a single file, so another upload of the same model counts as a different Item.
        </Text>
        {!disabled && (
          <div>
            <Button fill="outline" onClick={() => setAdding(true)}>
              Add Item
            </Button>
          </div>
        )}
      </SettingTile>
      {adding && (
        <AddItemDialog
          listed={value.items}
          allow={value.default === "block"}
          onAdd={add}
          requestClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

function CustomItemTile({
  item,
  render,
}: {
  item: ListedItem;
  render: (id: string, name: string, image: { src?: string; loading?: boolean }, removable: boolean) => JSX.Element;
}) {
  const image = useItemPreview(item.id, item.preview_url);
  return render(item.id, item.name || "Item", image, true);
}

/** Pick from your saved Items (with their pictures), or paste an Item's link. */
function AddItemDialog({
  listed,
  allow,
  onAdd,
  requestClose,
}: {
  listed: ListedItem[];
  allow: boolean;
  onAdd: (item: ListedItem) => void;
  requestClose: () => void;
}) {
  const { session, platform, client } = useMatrix(true);
  const [saved, setSaved] = useState<SavedItem[]>();
  const [error, setError] = useState<string>();
  const [link, setLink] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSessionAuth(platform, client.sessionId)
      .then((auth) => {
        if (!auth) throw new Error("Not signed in");
        return fetchItemCollection(auth, session.userId);
      })
      .then((c) => !cancelled && setSaved(c.items))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [session, platform, client]);

  const linkId = link.trim();
  const linkValid = isItemId(linkId) && linkId.startsWith("mxc://");
  const isListed = (id: string) => listed.some((t) => t.id === id);

  return (
    <AlertDialog
      open
      title={allow ? "Allow an Item" : "Block an Item"}
      requestClose={requestClose}
      content={
        <div className="flex flex-column gap-md">
          <SettingTile label={<Label>Item Link</Label>}>
            <div className="flex gap-xs">
              <Input
                className="grow"
                placeholder="mxc://server/id"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              <Button
                disabled={!linkValid || isListed(linkId)}
                onClick={() => {
                  onAdd({ id: linkId, allow });
                  setLink("");
                }}
              >
                Add
              </Button>
            </div>
            <Text variant="b3" color="surface-low">
              Use "Copy Item Link" on an Item in My Items, or on one posted in chat.
            </Text>
          </SettingTile>
          <SettingTile label={<Label>My Items</Label>}>
            {error && (
              <Text variant="b3" color="danger">
                {error}
              </Text>
            )}
            {!saved && !error && <Dots size="md" />}
            {saved?.length === 0 && (
              <Text variant="b3" color="surface-low">
                You haven't saved any Items yet. Upload one from the Items screen.
              </Text>
            )}
            {saved && saved.length > 0 && (
              <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
                <WorldTileGrid tall>
                  {saved.map((item) => (
                    <SavedItemPick
                      key={item.url}
                      item={item}
                      listed={isListed(item.url)}
                      onAdd={() => onAdd({ id: item.url, allow, name: item.name, preview_url: item.preview_url })}
                    />
                  ))}
                </WorldTileGrid>
              </div>
            )}
          </SettingTile>
        </div>
      }
    />
  );
}

function SavedItemPick({ item, listed, onAdd }: { item: SavedItem; listed: boolean; onAdd: () => void }) {
  const image = useItemPreview(item.url, item.preview_url);
  const name = item.name || "Item";
  return (
    <WorldTile
      shape="tall"
      imageSrc={image.src}
      fallback={
        image.loading ? (
          <div className="WorldTile__fallback flex items-center justify-center">
            <Dots size="md" />
          </div>
        ) : (
          <TileFallback name={name} color={`var(--usercolor${getIdentifierColorNumber(item.url)})`} />
        )
      }
      title={name}
      action={
        <Button size="sm" disabled={listed} onClick={onAdd}>
          {listed ? "Listed" : "Add"}
        </Button>
      }
    />
  );
}
