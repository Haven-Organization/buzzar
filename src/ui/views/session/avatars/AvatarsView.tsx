/**
 * Buzzar: the Avatars screen. Your Avatars: the stock ones that ship with Buzzar, then the ones you've bookmarked or
 * uploaded (kept in account data, software.haven.world.avatars). In World: what the people around you are wearing.
 *
 * "Wear" changes your default avatar and the one in the world you're in, like VRChat; the "…" menu has "Wear Only
 * in This World" for a per-world choice.
 */
import { ReactNode, useEffect, useMemo, useState } from "react";
import { GroupCall } from "@thirdroom/hydrogen-view-sdk";
import { useAtom, useAtomValue } from "jotai";

import { useOpenDetails } from "../../../hooks/useOpenDetails";
import { stripSaved, useAvatarWardrobe } from "../../../hooks/useAvatarWardrobe";
import { Content } from "../../../atoms/content/Content";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { Icon } from "../../../atoms/icon/Icon";
import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { Dots } from "../../../atoms/loading/Dots";
import { Scroll } from "../../../atoms/scroll/Scroll";
import { DropdownMenuItem } from "../../../atoms/menu/DropdownMenuItem";
import { SegmentControl } from "../../../atoms/segment-control/SegmentControl";
import { SegmentControlItem } from "../../../atoms/segment-control/SegmentControlItem";
import { Window } from "../../components/window/Window";
import { TileFallback, WorldTile, WorldTileGrid } from "../../components/world-tile/WorldTile";
import { Edit3DAvatar } from "../user-profile/Edit3DAvatar";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { useRoom } from "../../../hooks/useRoom";
import { useCalls } from "../../../hooks/useCalls";
import { useRoomCall } from "../../../hooks/useRoomCall";
import { useObservableMap } from "../../../hooks/useObservableMap";
import { getIdentifierColorNumber } from "../../../utils/avatar";
import { copyToClipboard } from "../../../utils/common";
import { getMxIdUsername } from "../../../utils/matrixUtils";
import {
  AvatarCollection,
  AvatarContent,
  BUILTIN_AVATARS,
  builtinIdForUrl,
  fetchAvatarCollection,
  builtinUrls,
  getBuiltinAvatarContent,
  getSessionAuth,
  MatrixAuth,
  resolveAvatar,
} from "../../../utils/avatarMatrix";
import { renderAvatarPreviewFromUrl } from "../../../utils/avatarPreview";
import { worldAtom } from "../../../state/world";
import { AvatarsTab, OverlayWindow, overlayWindowAtom } from "../../../state/overlayWindow";
import AvatarIC from "../../../../../res/ic/avatar.svg";
import UploadIC from "../../../../../res/ic/upload.svg";

const DEFAULT_PREVIEW = "/avatars/previews/default.png";

/** A stock avatar: "default" is the built-in rig (no avatar set), the others are bundled files. */
interface StockAvatar {
  id: string;
  name: string;
  preview: string;
  credit?: string;
}

const STOCK: StockAvatar[] = [
  { id: "default", name: "Default", preview: DEFAULT_PREVIEW },
  ...BUILTIN_AVATARS.map((a) => ({ id: a.id, name: a.name, preview: a.preview, credit: a.credit })),
];

export function AvatarsView() {
  const { session } = useHydrogen(true);
  const [overlayWindow, setOverlayWindow] = useAtom(overlayWindowAtom);
  const { worldId, entered } = useAtomValue(worldAtom);
  const inWorld = entered && !!worldId;
  const world = useRoom(session, inWorld ? worldId : undefined);

  const requested = overlayWindow.type === OverlayWindow.Avatars ? overlayWindow.tab : undefined;
  const tab: AvatarsTab = requested === "world" && !inWorld ? "yours" : requested ?? "yours";
  const setTab = (value: AvatarsTab) => setOverlayWindow({ type: OverlayWindow.Avatars, tab: value });

  const [uploadOpen, setUploadOpen] = useState(false);
  const {
    collection,
    wearing,
    busy,
    error,
    wearingWorldOnly,
    reload,
    wear,
    clearWorldChoice,
    bookmark,
    unbookmark,
    savePreview,
    isBookmarked,
    isWearing,
  } = useAvatarWardrobe();

  // Reload after the upload dialog closes (it may have added to your avatars).
  useEffect(() => {
    if (!uploadOpen) reload();
  }, [uploadOpen, reload]);

  const ctx: TileContext = {
    busy,
    savePreview,
    inWorld,
    wear,
    bookmark,
    unbookmark,
    isBookmarked,
    isWearing,
  };

  return (
    <Window className="TileScreen">
      <Edit3DAvatar open={uploadOpen} onOpenChange={setUploadOpen} />
      <Content
        top={
          <Header
            left={
              <HeaderTitle icon={<Icon color="surface" className="shrink-0" src={AvatarIC} />}>Avatars</HeaderTitle>
            }
            right={
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <Icon src={UploadIC} size="sm" color="on-primary" />
                Upload Avatar
              </Button>
            }
          />
        }
      >
        <div className="TileScreen__bar flex items-center gap-sm">
          <SegmentControl>
            <SegmentControlItem value="yours" isSelected={tab === "yours"} onSelect={setTab}>
              Your Avatars
            </SegmentControlItem>
            {inWorld ? (
              <SegmentControlItem value="world" isSelected={tab === "world"} onSelect={setTab}>
                In World
              </SegmentControlItem>
            ) : (
              <></>
            )}
          </SegmentControl>
          {wearingWorldOnly && (
            <>
              <Text variant="b3" color="surface-low">
                In this world you're wearing {wearing?.world?.name || "an avatar"} just for this world.
              </Text>
              <Button size="sm" fill="outline" disabled={!!busy} onClick={clearWorldChoice}>
                Use My Default Here
              </Button>
            </>
          )}
        </div>
        <Scroll type="hover">
          <div className="TileScreen__body">
            {error && (
              <Text className="TileScreen__note" variant="b3" color="danger">
                {error}
              </Text>
            )}
            {tab === "yours" && <YourAvatars ctx={ctx} collection={collection} />}
            {tab === "world" && world && <InWorldAvatars ctx={ctx} worldId={world.id} />}
          </div>
        </Scroll>
      </Content>
    </Window>
  );
}

interface TileContext {
  busy?: string;
  savePreview: (avatar: AvatarContent, image: Blob) => Promise<void>;
  inWorld: boolean;
  wear: (
    key: string,
    scope: "everywhere" | "world",
    getContent: (auth: MatrixAuth) => Promise<AvatarContent | undefined>
  ) => Promise<void>;
  bookmark: (avatar: AvatarContent) => Promise<void>;
  unbookmark: (url: string) => Promise<void>;
  isBookmarked: (url: string) => boolean;
  isWearing: (url: string | undefined) => boolean;
}

function WearButton({
  ctx,
  id,
  onWear,
  wearing,
}: {
  ctx: TileContext;
  id: string;
  onWear: () => void;
  wearing: boolean;
}) {
  if (wearing) {
    return (
      <Button size="sm" fill="outline" disabled>
        Wearing
      </Button>
    );
  }
  return (
    <Button size="sm" disabled={!!ctx.busy} onClick={onWear}>
      {ctx.busy === id ? <Dots size="sm" color="on-primary" /> : "Wear"}
    </Button>
  );
}

/**
 * Renders a preview for an avatar that has none (shown right away as a blob URL). With `save`, it's also uploaded and
 * stored with the avatar so it doesn't need rendering again.
 */
function useRenderedPreview(
  avatar: AvatarContent | undefined,
  save?: (avatar: AvatarContent, image: Blob) => Promise<void>
) {
  const { session } = useHydrogen(true);
  const [url, setUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const avatarUrl = avatar?.url;

  useEffect(() => {
    if (!avatar || !avatarUrl) return;
    const httpUrl = session.mediaRepository.mxcUrl(avatarUrl);
    if (!httpUrl) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    setLoading(true);
    renderAvatarPreviewFromUrl(avatarUrl, httpUrl)
      .then(async (blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        if (save && !savedPreviews.has(avatarUrl)) {
          savedPreviews.add(avatarUrl);
          await save(avatar, blob).catch((e) => {
            savedPreviews.delete(avatarUrl);
            console.warn("Couldn't save the avatar preview", e);
          });
        }
      })
      .catch((e) => console.warn("Couldn't render an avatar preview", e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarUrl, session]);

  return { url, loading };
}

/** Previews already being saved this session (so two tiles of the same avatar don't both upload one). */
const savedPreviews = new Set<string>();

function usePreview(mxc: string | undefined) {
  const { session } = useHydrogen(true);
  if (!mxc) return undefined;
  return session.mediaRepository.mxcUrlThumbnail(mxc, 360, 480, "scale") ?? undefined;
}

// --- Your Avatars: stock, then bookmarked and uploaded ---------------------------------------------------------------

function YourAvatars({ ctx, collection }: { ctx: TileContext; collection?: AvatarCollection }) {
  return (
    <div className="flex flex-column gap-md">
      <WorldTileGrid tall>
        {STOCK.map((avatar) => {
          const builtin = BUILTIN_AVATARS.find((a) => a.id === avatar.id);
          const wearing = builtin
            ? builtinUrls(collection, builtin).some((url) => ctx.isWearing(url))
            : ctx.isWearing(undefined);
          const getContent = async () => (builtin ? getBuiltinAvatarContent(builtin) : undefined);
          return (
            <StockTile
              key={avatar.id}
              avatar={avatar}
              ctx={ctx}
              wearing={wearing}
              getContent={getContent}
              builtin={!!builtin}
            />
          );
        })}
        {collection?.avatars.map((avatar) => (
          <AvatarTile
            key={avatar.url}
            ctx={ctx}
            avatar={avatar}
            ownAvatar
            subtitle={avatar.added_ts ? `Saved ${new Date(avatar.added_ts).toLocaleDateString()}` : "Saved avatar"}
            extraMenu={
              <DropdownMenuItem variant="danger" onSelect={() => ctx.unbookmark(avatar.url)}>
                Remove Bookmark
              </DropdownMenuItem>
            }
          />
        ))}
      </WorldTileGrid>
      {!collection ? (
        <Dots size="md" />
      ) : (
        collection.avatars.length === 0 && (
          <Text variant="b3" color="surface-low">
            Avatars you upload or bookmark show up here too. Bookmark someone's avatar from the In World tab while
            you're in a world.
          </Text>
        )
      )}
    </div>
  );
}

function StockTile({
  avatar,
  ctx,
  wearing,
  getContent,
  builtin,
}: {
  avatar: StockAvatar;
  ctx: TileContext;
  wearing: boolean;
  getContent: (auth: MatrixAuth) => Promise<AvatarContent | undefined>;
  builtin: boolean;
}) {
  const openDetails = useOpenDetails();
  const file = BUILTIN_AVATARS.find((a) => a.id === avatar.id)?.path;
  return (
    <WorldTile
      shape="tall"
      imageSrc={avatar.preview}
      title={avatar.name}
      onTitleClick={() =>
        openDetails({
          kind: "avatar",
          name: avatar.name,
          url: file,
          previewUrl: avatar.preview,
          credit: avatar.credit,
          builtinId: avatar.id,
        })
      }
      subtitle={
        <Text variant="b3" color="surface-low">
          {builtin ? avatar.credit : "Buzzar's built-in avatar"}
        </Text>
      }
      badge={wearing ? "Wearing" : undefined}
      isActive={wearing}
      action={
        <WearButton
          ctx={ctx}
          id={avatar.id}
          wearing={wearing}
          onWear={() => ctx.wear(avatar.id, "everywhere", getContent)}
        />
      }
      menu={
        ctx.inWorld ? (
          <DropdownMenuItem disabled={!!ctx.busy} onSelect={() => ctx.wear(avatar.id, "world", getContent)}>
            Wear Only in This World
          </DropdownMenuItem>
        ) : undefined
      }
    />
  );
}

function AvatarTile({
  ctx,
  avatar,
  subtitle,
  extraMenu,
  bookmarkable,
  imageSrc,
  ownAvatar,
}: {
  ctx: TileContext;
  avatar: AvatarContent;
  imageSrc?: string;
  /** Your own (bookmarked/uploaded) avatar: a rendered preview is saved to it. */
  ownAvatar?: boolean;
  subtitle?: string;
  extraMenu?: ReactNode;
  bookmarkable?: boolean;
}) {
  const preview = usePreview(avatar.preview_url);
  const rendered = useRenderedPreview(
    !avatar.preview_url && !imageSrc ? avatar : undefined,
    ownAvatar ? ctx.savePreview : undefined
  );
  const name = avatar.name || "Avatar";
  const wearing = ctx.isWearing(avatar.url);
  const content = async () => stripSaved(avatar);
  const openDetails = useOpenDetails();
  return (
    <WorldTile
      shape="tall"
      imageSrc={preview ?? imageSrc ?? rendered.url}
      onTitleClick={() =>
        openDetails({
          kind: "avatar",
          name,
          url: avatar.url,
          previewUrl: avatar.preview_url ?? imageSrc,
          format: avatar.format,
        })
      }
      fallback={
        rendered.loading ? (
          <div className="WorldTile__fallback flex flex-column items-center justify-center gap-xs">
            <Dots size="md" />
            <Text variant="b3" color="surface-low">
              Making a preview…
            </Text>
          </div>
        ) : (
          <TileFallback name={name} color={`var(--usercolor${getIdentifierColorNumber(avatar.url)})`} />
        )
      }
      title={name}
      subtitle={
        subtitle ? (
          <Text variant="b3" color="surface-low">
            {subtitle}
          </Text>
        ) : undefined
      }
      badge={wearing ? "Wearing" : undefined}
      isActive={wearing}
      action={
        <WearButton
          ctx={ctx}
          id={avatar.url}
          wearing={wearing}
          onWear={() => ctx.wear(avatar.url, "everywhere", content)}
        />
      }
      menu={
        <>
          {ctx.inWorld && (
            <DropdownMenuItem disabled={!!ctx.busy} onSelect={() => ctx.wear(avatar.url, "world", content)}>
              Wear Only in This World
            </DropdownMenuItem>
          )}
          {bookmarkable &&
            (ctx.isBookmarked(avatar.url) ? (
              <DropdownMenuItem onSelect={() => ctx.unbookmark(avatar.url)}>Remove Bookmark</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => ctx.bookmark(avatar)}>Bookmark</DropdownMenuItem>
            ))}
          <DropdownMenuItem onSelect={() => copyToClipboard(avatar.url)}>Copy Avatar Link</DropdownMenuItem>
          {extraMenu}
        </>
      }
    />
  );
}

// --- In World ----------------------------------------------------------------------------------------------------------

interface WornAvatar {
  avatar?: AvatarContent;
  wearers: string[];
}

function InWorldAvatars({ ctx, worldId }: { ctx: TileContext; worldId: string }) {
  const { session } = useHydrogen(true);
  const calls = useCalls(session);
  const groupCall = useRoomCall(calls, worldId);
  return groupCall ? (
    <InWorldAvatarsOfCall ctx={ctx} worldId={worldId} groupCall={groupCall} />
  ) : (
    <Text variant="b2">Nobody else is connected to this world right now.</Text>
  );
}

function InWorldAvatarsOfCall({
  ctx,
  worldId,
  groupCall,
}: {
  ctx: TileContext;
  worldId: string;
  groupCall: GroupCall;
}) {
  const { session, platform, client } = useHydrogen(true);
  const members = useObservableMap(() => groupCall.members, [groupCall]);
  const userIds = useMemo(
    () => [...new Set([...members.values()].map((m) => m.userId))].filter((id) => id !== session.userId).sort(),
    [members, session.userId]
  );
  const [worn, setWorn] = useState<WornAvatar[]>();
  const [collection, setCollection] = useState<AvatarCollection>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) return;
      const own = await fetchAvatarCollection(auth, session.userId).catch(() => undefined);
      const avatars = await Promise.all(userIds.map((id) => resolveAvatar(auth, worldId, id).catch(() => undefined)));
      if (cancelled) return;
      const byUrl = new Map<string, WornAvatar>();
      userIds.forEach((id, i) => {
        const avatar = avatars[i];
        const key = avatar?.url ?? "default";
        const entry = byUrl.get(key) ?? { avatar, wearers: [] };
        entry.wearers.push(id);
        byUrl.set(key, entry);
      });
      setCollection(own);
      setWorn([...byUrl.values()]);
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, client, session, worldId, userIds]);

  if (userIds.length === 0) return <Text variant="b2">Nobody else is connected to this world right now.</Text>;
  if (!worn) return <Dots size="md" />;

  const displayName = (userId: string) =>
    [...members.values()].find((m) => m.userId === userId)?.member?.displayName || getMxIdUsername(userId);
  const wearersText = (ids: string[]) =>
    `Worn by ${ids.slice(0, 3).map(displayName).join(", ")}${ids.length > 3 ? ` and ${ids.length - 3} more` : ""}`;

  return (
    <WorldTileGrid tall>
      {worn.map(({ avatar, wearers }) => {
        if (!avatar) {
          const wearing = ctx.isWearing(undefined);
          return (
            <WorldTile
              key="default"
              shape="tall"
              imageSrc={DEFAULT_PREVIEW}
              title="Default"
              subtitle={
                <Text variant="b3" color="surface-low">
                  {wearersText(wearers)}
                </Text>
              }
              badge={wearing ? "Wearing" : undefined}
              isActive={wearing}
              action={
                <WearButton
                  ctx={ctx}
                  id="default"
                  wearing={wearing}
                  onWear={() => ctx.wear("default", "everywhere", async () => undefined)}
                />
              }
            />
          );
        }
        // A stock avatar uploaded before previews were bundled with it: show the stock picture.
        const stock = !avatar.preview_url
          ? STOCK.find((s) => s.id === builtinIdForUrl(collection, avatar.url))
          : undefined;
        return (
          <AvatarTile
            key={avatar.url}
            ctx={ctx}
            avatar={avatar}
            imageSrc={stock?.preview}
            subtitle={wearersText(wearers)}
            bookmarkable
          />
        );
      })}
    </WorldTileGrid>
  );
}
