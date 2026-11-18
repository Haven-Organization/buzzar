/**
 * Buzzar: the Things screen: objects you can spawn into worlds and use with your avatar. The stock Things (the
 * crates and balls on the number keys) come first, then Things you've bookmarked (e.g. from a .glb posted in chat;
 * kept in account data, see thingsMatrix.ts).
 */
import { useCallback, useEffect, useState } from "react";
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
  ThingCollection,
} from "../../../utils/thingsMatrix";
import { renderAvatarPreviewFromUrl } from "../../../utils/avatarPreview";
import { worldAtom } from "../../../state/world";
import { Thread } from "../../../../engine/module/module.common";
import { SpawnThingMessage, ThirdRoomMessageType } from "../../../../plugins/thirdroom/thirdroom.common";
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
            <WorldTileGrid tall>
              {STOCK_THINGS.map((thing) => {
                const key = STOCK_THINGS.indexOf(thing) + 1;
                const here = allowed.some((item) => item.id === thing.id);
                return (
                  <WorldTile
                    key={thing.id}
                    shape="tall"
                    imageSrc={thing.preview}
                    title={thing.name}
                    subtitle={
                      <Text variant="b3" color="surface-low">
                        {thing.description}
                        {` · key ${key}`}
                      </Text>
                    }
                    action={
                      inWorld ? (
                        here ? (
                          <Button size="sm" onClick={() => spawn(thing.id)}>
                            Spawn
                          </Button>
                        ) : (
                          <Button size="sm" fill="outline" disabled>
                            Not Allowed Here
                          </Button>
                        )
                      ) : undefined
                    }
                  />
                );
              })}
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
