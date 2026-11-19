/**
 * Buzzar: the Things screen: objects you can spawn into worlds and use with your avatar. "On Your Keys" is a shelf of
 * the Things on number keys 1–0 (you choose which; utils/thingKeys), and "My Things" has the rest: the other stock
 * Things, then Things you've bookmarked (e.g. from a .glb posted in chat; kept in account data, see thingsMatrix.ts).
 */
import { ReactNode, useCallback, useEffect, useState } from "react";
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
  THING_KEY_COUNT,
  ThirdRoomMessageType,
} from "../../../../plugins/thirdroom/thirdroom.common";
import { thingKeysAtom } from "../../../state/thingKeys";
import { useSetThingKeys } from "../../../hooks/useThingKeys";
import { mapThing, unmapThing } from "../../../utils/thingKeys";
import BoxIC from "../../../../../res/ic/box-3d.svg";

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
                On Your Keys
              </Text>
              <Text variant="b3" color="surface-low">
                Press a Thing’s number key in a world to spawn it.
                {keys && freeKeys.length > 0 ? ` Free keys: ${freeKeys.join(", ")}.` : ""} Use a Thing’s menu to put it
                on a key or take it off.
              </Text>
              {keys && mapped.length === 0 && (
                <Text variant="b3" color="surface-low">
                  Nothing on your keys yet.
                </Text>
              )}
              {mapped.length > 0 && (
                <WorldTileGrid tall>
                  {mapped.map(({ thing, slot }) => (
                    <StockThingTile
                      key={thing.id}
                      thing={thing}
                      slot={slot}
                      keys={keys!}
                      action={spawnAction(thing.id)}
                      onChangeKeys={changeKeys}
                    />
                  ))}
                </WorldTileGrid>
              )}
            </div>
            <Text variant="b2" weight="semi-bold">
              My Things
            </Text>
            <WorldTileGrid tall>
              {unmapped.map((thing) => (
                <StockThingTile
                  key={thing.id}
                  thing={thing}
                  keys={keys}
                  action={spawnAction(thing.id)}
                  onChangeKeys={changeKeys}
                />
              ))}
              {collection?.things.map((thing) => (
                <SavedThingTile key={thing.url} thing={thing} onRemove={() => unbookmark(thing.url)} />
              ))}
            </WorldTileGrid>
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

/** A stock Thing, with its key (if it's on one) and a menu to put it on a key, move it, or take it off. */
function StockThingTile({
  thing,
  slot,
  keys,
  action,
  onChangeKeys,
}: {
  thing: StockThing;
  slot?: number;
  keys?: ThingKeys;
  action?: ReactNode;
  onChangeKeys: (keys: ThingKeys) => void;
}) {
  const onKey = slot !== undefined;
  return (
    <WorldTile
      shape="tall"
      imageSrc={thing.preview}
      title={thing.name}
      badge={onKey ? `Key ${thingKeyName(slot)}` : undefined}
      subtitle={
        <Text variant="b3" color="surface-low">
          {thing.description}
        </Text>
      }
      action={action}
      menu={
        keys && (
          <>
            {Array.from({ length: THING_KEY_COUNT }, (_, i) => {
              if (i === slot) return null;
              const occupant = keys[i] ? STOCK_THINGS.find((t) => t.id === keys[i])?.name : undefined;
              return (
                <DropdownMenuItem key={i} onSelect={() => onChangeKeys(mapThing(keys, thing.id, i))}>
                  {`${onKey ? "Move to" : "Put on"} Key ${thingKeyName(i)}${
                    occupant ? ` (${onKey ? "swap with" : "replaces"} ${occupant})` : ""
                  }`}
                </DropdownMenuItem>
              );
            })}
            {onKey && (
              <DropdownMenuItem variant="danger" onSelect={() => onChangeKeys(unmapThing(keys, thing.id))}>
                Take Off Key {thingKeyName(slot)}
              </DropdownMenuItem>
            )}
          </>
        )
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
