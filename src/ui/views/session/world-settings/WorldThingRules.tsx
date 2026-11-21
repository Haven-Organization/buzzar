/**
 * Buzzar: World Settings → Things: which Things people may spawn in this world (software.haven.world.rules →
 * `objects`). Either a block list (everything except the Things marked blocked) or an allow list (nothing except
 * the Things marked allowed), plus behaviours turned off for every Thing (e.g. trampolines). Custom Things are
 * listed by their exact file, so a world can allow its own Things and nothing else. Every visitor's client enforces
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
import { useThingPreview } from "../../../hooks/useThingPreview";
import { getIdentifierColorNumber } from "../../../utils/avatar";
import { getSessionAuth } from "../../../utils/avatarMatrix";
import { fetchThingCollection, SavedThing, STOCK_THINGS } from "../../../utils/thingsMatrix";
import {
  isSpawnAllowed,
  isThingId,
  ListedThing,
  MAX_LISTED_THINGS,
  SpawnRules,
  thingBehaviours,
} from "../../../../engine/network/spawnRules.common";

export interface ThingRulesDraft {
  default: "allow" | "block";
  things: ListedThing[];
  blockedBehaviours: string[];
}

const BEHAVIOURS: { id: string; label: string; short: string }[] = [
  { id: "HAVEN_trampoline", label: "Trampolines and other bouncy Things", short: "bouncy Things are off" },
];

const MODES = [
  { value: "allow" as const, label: "Allow every Thing except the ones blocked below" },
  { value: "block" as const, label: "Block every Thing except the ones allowed below" },
];

function toRules(draft: ThingRulesDraft): SpawnRules {
  return {
    default: draft.default,
    things: Object.fromEntries(draft.things.map((t) => [t.id, t.allow])),
    blockedBehaviours: draft.blockedBehaviours,
  };
}

interface Props {
  value: ThingRulesDraft;
  onChange: (value: ThingRulesDraft) => void;
  disabled?: boolean;
}

export function WorldThingRules({ value, onChange, disabled }: Props) {
  const [adding, setAdding] = useState(false);
  const rules = toRules(value);
  const custom = value.things.filter((t) => !STOCK_THINGS.some((s) => s.id === t.id));

  /** Flips a Thing. Stock Things leave the list when they're back to the default; custom ones stay listed. */
  const toggle = (id: string, extra?: Partial<ListedThing>) => {
    const allow = !(rules.things[id] ?? rules.default !== "block");
    const isStock = STOCK_THINGS.some((s) => s.id === id);
    const existing = value.things.find((t) => t.id === id);
    let things: ListedThing[];
    if (isStock && allow === (value.default !== "block")) things = value.things.filter((t) => t.id !== id);
    else if (existing) things = value.things.map((t) => (t.id === id ? { ...t, allow } : t));
    else things = [...value.things, { id, allow, ...extra }];
    onChange({ ...value, things });
  };

  const add = (thing: ListedThing) => {
    if (value.things.some((t) => t.id === thing.id)) return;
    onChange({ ...value, things: [...value.things, thing].slice(0, MAX_LISTED_THINGS) });
  };

  const remove = (id: string) => onChange({ ...value, things: value.things.filter((t) => t.id !== id) });

  const behaviourBlock = (id: string) =>
    BEHAVIOURS.find((b) => value.blockedBehaviours.includes(b.id) && thingBehaviours(id).includes(b.id));

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
      <SettingTile label={<Label>Things People Can Spawn</Label>}>
        <SelectInput
          options={MODES}
          value={value.default}
          disabled={disabled}
          onChange={(mode) => onChange({ ...value, default: mode })}
        />
        <Text variant="b3" color="surface-low">
          {value.default === "block"
            ? "Only the Things marked Allowed can be spawned here. Use this to allow just your own Things."
            : "Any Thing can be spawned here, including people's own, except the ones marked Blocked."}
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
          Unchecked behaviours are off for every spawned Thing that has them, whatever the list says, so nobody gets
          round the rule with a Thing of their own.
        </Text>
      </SettingTile>
      <SettingTile label={<Label>Stock Things</Label>}>
        <WorldTileGrid tall>
          {STOCK_THINGS.map((thing) => tile(thing.id, thing.name, { src: thing.preview }, false))}
        </WorldTileGrid>
      </SettingTile>
      <SettingTile label={<Label>Other Things</Label>}>
        {custom.length > 0 && (
          <WorldTileGrid tall>
            {custom.map((thing) => (
              <CustomThingTile key={thing.id} thing={thing} render={tile} />
            ))}
          </WorldTileGrid>
        )}
        <Text variant="b3" color="surface-low">
          {custom.length === 0 &&
            (value.default === "block"
              ? "None yet. Add the Things you've made for this world to allow them. "
              : "None yet. Add a Thing to block that exact file. ")}
          Each one is a single file, so another upload of the same model counts as a different Thing.
        </Text>
        {!disabled && (
          <div>
            <Button fill="outline" onClick={() => setAdding(true)}>
              Add Thing
            </Button>
          </div>
        )}
      </SettingTile>
      {adding && (
        <AddThingDialog
          listed={value.things}
          allow={value.default === "block"}
          onAdd={add}
          requestClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

function CustomThingTile({
  thing,
  render,
}: {
  thing: ListedThing;
  render: (id: string, name: string, image: { src?: string; loading?: boolean }, removable: boolean) => JSX.Element;
}) {
  const image = useThingPreview(thing.id, thing.preview_url);
  return render(thing.id, thing.name || "Thing", image, true);
}

/** Pick from your saved Things (with their pictures), or paste a Thing's link. */
function AddThingDialog({
  listed,
  allow,
  onAdd,
  requestClose,
}: {
  listed: ListedThing[];
  allow: boolean;
  onAdd: (thing: ListedThing) => void;
  requestClose: () => void;
}) {
  const { session, platform, client } = useMatrix(true);
  const [saved, setSaved] = useState<SavedThing[]>();
  const [error, setError] = useState<string>();
  const [link, setLink] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSessionAuth(platform, client.sessionId)
      .then((auth) => {
        if (!auth) throw new Error("Not signed in");
        return fetchThingCollection(auth, session.userId);
      })
      .then((c) => !cancelled && setSaved(c.things))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [session, platform, client]);

  const linkId = link.trim();
  const linkValid = isThingId(linkId) && linkId.startsWith("mxc://");
  const isListed = (id: string) => listed.some((t) => t.id === id);

  return (
    <AlertDialog
      open
      title={allow ? "Allow a Thing" : "Block a Thing"}
      requestClose={requestClose}
      content={
        <div className="flex flex-column gap-md">
          <SettingTile label={<Label>Thing Link</Label>}>
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
              Use "Copy Thing Link" on a Thing in My Things, or on one posted in chat.
            </Text>
          </SettingTile>
          <SettingTile label={<Label>My Things</Label>}>
            {error && (
              <Text variant="b3" color="danger">
                {error}
              </Text>
            )}
            {!saved && !error && <Dots size="md" />}
            {saved?.length === 0 && (
              <Text variant="b3" color="surface-low">
                You haven't saved any Things yet. Upload one from the Things screen.
              </Text>
            )}
            {saved && saved.length > 0 && (
              <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
                <WorldTileGrid tall>
                  {saved.map((thing) => (
                    <SavedThingPick
                      key={thing.url}
                      thing={thing}
                      listed={isListed(thing.url)}
                      onAdd={() => onAdd({ id: thing.url, allow, name: thing.name, preview_url: thing.preview_url })}
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

function SavedThingPick({ thing, listed, onAdd }: { thing: SavedThing; listed: boolean; onAdd: () => void }) {
  const image = useThingPreview(thing.url, thing.preview_url);
  const name = thing.name || "Thing";
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
          <TileFallback name={name} color={`var(--usercolor${getIdentifierColorNumber(thing.url)})`} />
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
