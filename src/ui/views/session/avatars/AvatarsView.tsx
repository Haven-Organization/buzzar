/**
 * Buzzar: the Avatars screen. Stock avatars that ship with Buzzar, avatars you've bookmarked (or uploaded; kept in
 * account data, software.haven.world.avatars), and the avatars people around you in the world are wearing.
 *
 * "Wear" changes your default avatar and the one in the world you're in, like VRChat; the "…" menu has "Wear Only
 * in This World" for a per-world choice.
 */
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { GroupCall } from "@thirdroom/hydrogen-view-sdk";
import { useAtom, useAtomValue } from "jotai";

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
  fetchProfileAvatar,
  fetchWorldAvatar,
  getBuiltinAvatarContent,
  getSessionAuth,
  MatrixAuth,
  removeFromAvatarCollection,
  resolveAvatar,
  saveToAvatarCollection,
  setProfileAvatar,
  setWorldAvatar,
  uploadMedia,
} from "../../../utils/avatarMatrix";
import { renderAvatarPreviewFromUrl } from "../../../utils/avatarPreview";
import { refreshWorldAvatar } from "../../../../engine/avatar/avatar.main";
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

interface Wearing {
  profile?: AvatarContent;
  world?: AvatarContent;
}

export function AvatarsView() {
  const { session, platform, client, profileRoom } = useHydrogen(true);
  const [overlayWindow, setOverlayWindow] = useAtom(overlayWindowAtom);
  const { worldId, entered } = useAtomValue(worldAtom);
  const inWorld = entered && !!worldId;
  const world = useRoom(session, inWorld ? worldId : undefined);

  const requested = overlayWindow.type === OverlayWindow.Avatars ? overlayWindow.tab : undefined;
  const tab: AvatarsTab = requested === "world" && !inWorld ? "stock" : requested ?? "stock";
  const setTab = (value: AvatarsTab) => setOverlayWindow({ type: OverlayWindow.Avatars, tab: value });

  const [collection, setCollection] = useState<AvatarCollection>();
  const [wearing, setWearing] = useState<Wearing>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [uploadOpen, setUploadOpen] = useState(false);

  const getAuth = useCallback(async () => {
    const auth = await getSessionAuth(platform, client.sessionId);
    if (!auth) throw new Error("Not signed in");
    return auth;
  }, [platform, client]);

  const reload = useCallback(async () => {
    try {
      const auth = await getAuth();
      const [loaded, profile, worldAvatar] = await Promise.all([
        fetchAvatarCollection(auth, session.userId).catch(() => undefined),
        fetchProfileAvatar(auth, session.userId).catch(() => undefined),
        inWorld ? fetchWorldAvatar(auth, worldId!, session.userId).catch(() => undefined) : undefined,
      ]);
      if (loaded) setCollection(loaded);
      setWearing({ profile, world: worldAvatar });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [getAuth, session, inWorld, worldId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Reload after the upload dialog closes (it may have added to your avatars).
  useEffect(() => {
    if (!uploadOpen) reload();
  }, [uploadOpen, reload]);

  /** What you look like here: this world's own choice, else your default. */
  const current = wearing?.world ?? wearing?.profile;

  /**
   * Wear an avatar. "everywhere": your default (profile) and this world; "world": just this world.
   * `content` undefined = the built-in default rig.
   */
  const wear = async (
    key: string,
    scope: "everywhere" | "world",
    getContent: (auth: MatrixAuth) => Promise<AvatarContent | undefined>
  ) => {
    setBusy(key);
    setError(undefined);
    try {
      const auth = await getAuth();
      const content = await getContent(auth);
      if (scope === "everywhere") {
        await setProfileAvatar(auth, session.userId, content);
        // Keep Third Room's legacy (private) profile state in sync for compatibility, when that room exists.
        if (profileRoom && content) {
          await session.hsApi.sendState(profileRoom.id, "org.matrix.msc3815.world.profile", "", {
            avatar_url: content.url,
            avatar_preview_url: content.preview_url,
          });
        }
      }
      if (inWorld) {
        await setWorldAvatar(auth, worldId!, session.userId, scope === "world" ? content : undefined);
        refreshWorldAvatar(session.userId);
      }
      setWearing((w) => ({
        profile: scope === "everywhere" ? content : w?.profile,
        world: scope === "world" ? content : undefined,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const clearWorldChoice = async () => {
    setBusy("clear-world");
    setError(undefined);
    try {
      const auth = await getAuth();
      await setWorldAvatar(auth, worldId!, session.userId, undefined);
      refreshWorldAvatar(session.userId);
      setWearing((w) => ({ ...w, world: undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const bookmark = async (avatar: AvatarContent) => {
    setError(undefined);
    try {
      const auth = await getAuth();
      setCollection(await saveToAvatarCollection(auth, session.userId, avatar));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const unbookmark = async (url: string) => {
    setError(undefined);
    try {
      const auth = await getAuth();
      setCollection(await removeFromAvatarCollection(auth, session.userId, url));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** A rendered preview of one of your own avatars: upload it and remember it (and on your profile if worn). */
  const savePreview = useCallback(
    async (avatar: AvatarContent, image: Blob) => {
      const auth = await getAuth();
      const previewUrl = await uploadMedia(auth, image, "avatar-preview.png");
      const content: AvatarContent = { ...stripSaved(avatar), preview_url: previewUrl };
      setCollection(await saveToAvatarCollection(auth, session.userId, content));
      const profile = await fetchProfileAvatar(auth, session.userId).catch(() => undefined);
      if (profile?.url === avatar.url && !profile.preview_url) {
        await setProfileAvatar(auth, session.userId, { ...profile, preview_url: previewUrl });
        setWearing((w) => (w ? { ...w, profile: { ...profile, preview_url: previewUrl } } : w));
      }
    },
    [getAuth, session]
  );

  const isBookmarked = (url: string) => !!collection?.avatars.some((a) => a.url === url);
  const isWearing = (url: string | undefined) => (url ? current?.url === url : !!wearing && !current);
  const wearingWorldOnly = inWorld && wearing?.world && wearing.world.url !== wearing.profile?.url;

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
            <SegmentControlItem value="stock" isSelected={tab === "stock"} onSelect={setTab}>
              Stock
            </SegmentControlItem>
            <SegmentControlItem value="bookmarked" isSelected={tab === "bookmarked"} onSelect={setTab}>
              Bookmarked
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
            {tab === "stock" && <StockAvatars ctx={ctx} collection={collection} />}
            {tab === "bookmarked" && <BookmarkedAvatars ctx={ctx} collection={collection} />}
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

function WearButton({ ctx, id, onWear, wearing }: { ctx: TileContext; id: string; onWear: () => void; wearing: boolean }) {
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

/** Only the avatar fields (bookmarks also carry added_ts). */
function stripSaved(avatar: AvatarContent): AvatarContent {
  const out: AvatarContent = { url: avatar.url };
  if (avatar.preview_url) out.preview_url = avatar.preview_url;
  if (avatar.format) out.format = avatar.format;
  if (avatar.name) out.name = avatar.name;
  return out;
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

// --- Stock ------------------------------------------------------------------------------------------------------------

function StockAvatars({ ctx, collection }: { ctx: TileContext; collection?: AvatarCollection }) {
  const { session } = useHydrogen(true);
  return (
    <WorldTileGrid tall>
      {STOCK.map((avatar) => {
        const builtin = BUILTIN_AVATARS.find((a) => a.id === avatar.id);
        const uploadedUrl = builtin ? collection?.builtin[builtin.id] : undefined;
        const wearing = builtin ? !!uploadedUrl && ctx.isWearing(uploadedUrl) : ctx.isWearing(undefined);
        const getContent = async (auth: MatrixAuth) =>
          builtin ? getBuiltinAvatarContent(auth, session.userId, builtin) : undefined;
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
    </WorldTileGrid>
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
  return (
    <WorldTile
      shape="tall"
      imageSrc={avatar.preview}
      title={avatar.name}
      subtitle={
        <Text variant="b3" color="surface-low">
          {builtin ? avatar.credit : "Buzzar's built-in avatar"}
        </Text>
      }
      badge={wearing ? "Wearing" : undefined}
      isActive={wearing}
      action={
        <WearButton ctx={ctx} id={avatar.id} wearing={wearing} onWear={() => ctx.wear(avatar.id, "everywhere", getContent)} />
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

// --- Bookmarked ------------------------------------------------------------------------------------------------------

function BookmarkedAvatars({ ctx, collection }: { ctx: TileContext; collection?: AvatarCollection }) {
  if (!collection) return <Dots size="md" />;
  if (collection.avatars.length === 0) {
    return (
      <Text variant="b2">
        Avatars you upload or bookmark show up here. Bookmark someone's avatar from the In World tab while you're in a
        world.
      </Text>
    );
  }
  return (
    <WorldTileGrid tall>
      {collection.avatars.map((avatar) => (
        <AvatarTile
          key={avatar.url}
          ctx={ctx}
          avatar={avatar}
          ownAvatar
          subtitle={
            avatar.added_ts ? `Saved ${new Date(avatar.added_ts).toLocaleDateString()}` : "Saved avatar"
          }
          extraMenu={
            <DropdownMenuItem variant="danger" onSelect={() => ctx.unbookmark(avatar.url)}>
              Remove Bookmark
            </DropdownMenuItem>
          }
        />
      ))}
    </WorldTileGrid>
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
  return (
    <WorldTile
      shape="tall"
      imageSrc={preview ?? imageSrc ?? rendered.url}
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
        <WearButton ctx={ctx} id={avatar.url} wearing={wearing} onWear={() => ctx.wear(avatar.url, "everywhere", content)} />
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

function InWorldAvatarsOfCall({ ctx, worldId, groupCall }: { ctx: TileContext; worldId: string; groupCall: GroupCall }) {
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
        const stock = !avatar.preview_url ? STOCK.find((s) => s.id === builtinIdForUrl(collection, avatar.url)) : undefined;
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
