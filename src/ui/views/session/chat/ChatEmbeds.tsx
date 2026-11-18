/**
 * Buzzar: tiles inside chat messages. The timeline's message views (Hydrogen templates) leave placeholder elements
 * (`data-model-mxc` for a .glb/.vrm file, `data-world-link` for a linked room); ChatTimeline finds them and renders
 * these React tiles into them through portals, so they get the app's state (session, wearing avatars, dialogs).
 */
import { ReactNode, RefObject, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAtomValue, useSetAtom } from "jotai";

import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { Dots } from "../../../atoms/loading/Dots";
import { TileFallback, WorldTile } from "../../components/world-tile/WorldTile";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { getIdentifierColorNumber } from "../../../utils/avatar";
import {
  AvatarContent,
  AvatarFormat,
  fetchAvatarCollection,
  getSessionAuth,
  saveToAvatarCollection,
  setProfileAvatar,
  setWorldAvatar,
  uploadMedia,
} from "../../../utils/avatarMatrix";
import { fetchThingCollection, saveToThingCollection } from "../../../utils/thingsMatrix";
import { classifyModel, fetchGlbJson, ModelKind } from "../../../utils/chatEmbeds";
import { renderAvatarPreviewFromUrl } from "../../../utils/avatarPreview";
import { refreshWorldAvatar } from "../../../../engine/avatar/avatar.main";
import { worldAtom } from "../../../state/world";
import { overlayWorldAtom } from "../../../state/overlayWorld";
import { OverlayWindow, overlayWindowAtom } from "../../../state/overlayWindow";
import "./ChatEmbeds.css";

/** Previews are rendered automatically for files up to this size; bigger ones on request. */
const AUTO_PREVIEW_BYTES = 30 * 1024 * 1024;

type Embed =
  | { el: HTMLElement; kind: "model"; mxc: string; name: string; size?: number }
  | { el: HTMLElement; kind: "world"; target: string; via: string[] };

function readEmbed(el: HTMLElement): Embed | undefined {
  const mxc = el.dataset.modelMxc;
  if (mxc) {
    const size = Number(el.dataset.modelSize);
    return { el, kind: "model", mxc, name: el.dataset.modelName || "model.glb", size: size > 0 ? size : undefined };
  }
  const target = el.dataset.worldLink;
  if (target) return { el, kind: "world", target, via: (el.dataset.worldVia ?? "").split(",").filter(Boolean) };
  return undefined;
}

/** Finds the placeholders in the timeline (as messages arrive, scroll in or are edited) and renders tiles into them. */
export function useChatEmbedPortals(containerRef: RefObject<HTMLElement>): ReactNode {
  const [embeds, setEmbeds] = useState<Embed[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scan = () => {
      setEmbeds((current) => {
        const alive = current.filter((e) => e.el.isConnected);
        const known = new Set(alive.map((e) => e.el));
        const found: Embed[] = [];
        container.querySelectorAll<HTMLElement>("[data-model-mxc], [data-world-link]").forEach((el) => {
          if (known.has(el)) return;
          const embed = readEmbed(el);
          if (embed) found.push(embed);
        });
        return found.length === 0 && alive.length === current.length ? current : [...alive, ...found];
      });
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [containerRef]);

  return embeds.map((embed, i) =>
    createPortal(
      embed.kind === "model" ? (
        <ChatModelEmbed mxc={embed.mxc} name={embed.name} size={embed.size} />
      ) : (
        <ChatWorldEmbed target={embed.target} via={embed.via} />
      ),
      embed.el,
      `${embed.kind}-${i}-${embed.kind === "model" ? embed.mxc : embed.target}`
    )
  );
}

function useAuth() {
  const { platform, client } = useHydrogen(true);
  return useCallback(async () => {
    const auth = await getSessionAuth(platform, client.sessionId);
    if (!auth) throw new Error("Not signed in");
    return auth;
  }, [platform, client]);
}

const KIND_LABEL: Record<ModelKind, string> = { avatar: "Avatar", world: "World", thing: "Thing" };

/** A .glb/.vrm posted in chat: what it is, a preview, and what you can do with it. */
function ChatModelEmbed({ mxc, name, size }: { mxc: string; name: string; size?: number }) {
  const { session, profileRoom } = useHydrogen(true);
  const getAuth = useAuth();
  const { worldId, entered } = useAtomValue(worldAtom);
  const setOverlayWindow = useSetAtom(overlayWindowAtom);
  const [kind, setKind] = useState<ModelKind>();
  const [format, setFormat] = useState<AvatarFormat>("glb");
  const [failed, setFailed] = useState(false);
  const [wantPreview, setWantPreview] = useState(size === undefined || size <= AUTO_PREVIEW_BYTES);
  const [preview, setPreview] = useState<{ url: string; blob: Blob }>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [status, setStatus] = useState<string>();
  const httpUrl = session.mediaRepository.mxcUrl(mxc) ?? undefined;
  const title = name.replace(/\.(glb|vrm)$/i, "");

  // What it is, from the file's description (the first few KB).
  useEffect(() => {
    if (!httpUrl) return;
    const abort = new AbortController();
    fetchGlbJson(httpUrl, abort.signal)
      .then((json) => {
        const exts = new Set([...(json.extensionsUsed ?? []), ...Object.keys(json.extensions ?? {})]);
        setFormat(exts.has("VRMC_vrm") ? "vrm1" : exts.has("VRM") ? "vrm0" : "glb");
        setKind(classifyModel(json, name));
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          console.warn("Couldn't read a model posted in chat", e);
          setFailed(true);
        }
      });
    return () => abort.abort();
  }, [httpUrl, name]);

  // Its preview.
  useEffect(() => {
    if (!kind || !wantPreview || !httpUrl) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    setPreviewLoading(true);
    renderAvatarPreviewFromUrl(mxc, httpUrl, kind === "avatar" ? "avatar" : kind)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ url: objectUrl, blob });
      })
      .catch((e) => console.warn("Couldn't render a preview of a model posted in chat", e))
      .finally(() => !cancelled && setPreviewLoading(false));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [kind, wantPreview, httpUrl, mxc]);

  // Already bookmarked?
  useEffect(() => {
    if (kind !== "avatar" && kind !== "thing") return;
    let cancelled = false;
    getAuth()
      .then((auth) =>
        kind === "avatar"
          ? fetchAvatarCollection(auth, session.userId).then((c) => c.avatars.some((a) => a.url === mxc))
          : fetchThingCollection(auth, session.userId).then((c) => c.things.some((t) => t.url === mxc))
      )
      .then((isSaved) => !cancelled && setSaved(isSaved))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [kind, getAuth, session, mxc]);

  const run = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key);
    setStatus(undefined);
    try {
      const done = await action();
      if (done) setStatus(done);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  /** The rendered preview, uploaded (so bookmarks and new worlds have a picture). */
  const uploadPreview = async () => {
    if (!preview) return undefined;
    return uploadMedia(await getAuth(), preview.blob, `${kind ?? "model"}-preview.png`);
  };

  const avatarContent = async (): Promise<AvatarContent> => {
    const previewUrl = await uploadPreview();
    return { url: mxc, format, name: title, ...(previewUrl ? { preview_url: previewUrl } : {}) };
  };

  const bookmark = () =>
    run("bookmark", async () => {
      const auth = await getAuth();
      if (kind === "avatar") await saveToAvatarCollection(auth, session.userId, await avatarContent());
      else {
        const previewUrl = await uploadPreview();
        await saveToThingCollection(auth, session.userId, {
          url: mxc,
          name: title,
          ...(previewUrl ? { preview_url: previewUrl } : {}),
        });
      }
      setSaved(true);
      return kind === "avatar" ? "Added to Your Avatars." : "Added to Things.";
    });

  const wear = () =>
    run("wear", async () => {
      const auth = await getAuth();
      const content = await avatarContent();
      await setProfileAvatar(auth, session.userId, content);
      // Keep Third Room's legacy (private) profile state in sync for compatibility, when that room exists.
      if (profileRoom) {
        await session.hsApi.sendState(profileRoom.id, "org.matrix.msc3815.world.profile", "", {
          avatar_url: content.url,
          avatar_preview_url: content.preview_url,
        });
      }
      // Like Wear on the Avatars screen: your default, and this world too (dropping a choice just for here).
      if (entered && worldId) {
        await setWorldAvatar(auth, worldId, session.userId, undefined);
        refreshWorldAvatar(session.userId);
      }
      return "You're wearing it.";
    });

  const createWorld = () =>
    run("world", async () => {
      const previewUrl = await uploadPreview();
      if (!previewUrl) throw new Error("Wait for the preview first: a new world needs a picture.");
      setOverlayWindow({ type: OverlayWindow.CreateWorld, scene: { url: mxc, previewUrl } });
    });

  if (failed) return null;
  const tall = kind !== "world";
  return (
    <div className={tall ? "ChatEmbed__card ChatEmbed__card--tall" : "ChatEmbed__card"}>
      <WorldTile
        shape={tall ? "tall" : "wide"}
        imageSrc={preview?.url}
        fallback={
          !kind || previewLoading ? (
            <div className="WorldTile__fallback flex flex-column items-center justify-center gap-xs">
              <Dots size="md" />
              <Text variant="b3" color="surface-low">
                {kind ? "Making a preview…" : "Reading the file…"}
              </Text>
            </div>
          ) : !wantPreview ? (
            <div className="WorldTile__fallback flex flex-column items-center justify-center gap-xs">
              <Button size="sm" fill="outline" onClick={() => setWantPreview(true)}>
                Show Preview
              </Button>
            </div>
          ) : (
            <TileFallback name={title} color={`var(--usercolor${getIdentifierColorNumber(mxc)})`} />
          )
        }
        title={title}
        subtitle={
          <Text variant="b3" color={status ? "surface" : "surface-low"}>
            {status ?? (kind ? KIND_LABEL[kind] : "3D model")}
          </Text>
        }
        action={
          kind === "avatar" ? (
            <>
              <Button size="sm" fill="outline" disabled={!!busy || saved} onClick={bookmark}>
                {busy === "bookmark" ? <Dots size="sm" /> : saved ? "Bookmarked" : "Bookmark"}
              </Button>
              <Button size="sm" disabled={!!busy} onClick={wear}>
                {busy === "wear" ? <Dots size="sm" color="on-primary" /> : "Wear"}
              </Button>
            </>
          ) : kind === "world" ? (
            <Button size="sm" disabled={!!busy || previewLoading} onClick={createWorld}>
              {busy === "world" ? <Dots size="sm" color="on-primary" /> : "Create World"}
            </Button>
          ) : kind === "thing" ? (
            <Button size="sm" fill={saved ? "outline" : undefined} disabled={!!busy || saved} onClick={bookmark}>
              {busy === "bookmark" ? <Dots size="sm" /> : saved ? "Bookmarked" : "Bookmark"}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

interface WorldSummary {
  roomId?: string;
  name?: string;
  topic?: string;
  members?: number;
  image?: string;
}

/** A linked room: if it's a world, a tile with what it is and a Join button. */
function ChatWorldEmbed({ target, via }: { target: string; via: string[] }) {
  const { session } = useHydrogen(true);
  const getAuth = useAuth();
  const setOverlayWindow = useSetAtom(overlayWindowAtom);
  const selectWorld = useSetAtom(overlayWorldAtom);
  const [world, setWorld] = useState<WorldSummary | null>();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const auth = await getAuth();
      const base = auth.homeserver.replace(/\/+$/, "");
      const params = new URLSearchParams();
      for (const server of via) params.append("via", server);
      const res = await fetch(
        `${base}/_matrix/client/v1/room_summary/${encodeURIComponent(target)}${via.length ? `?${params}` : ""}`,
        { headers: { Authorization: `Bearer ${auth.accessToken}` } }
      );
      if (!res.ok) return null;
      const s = (await res.json()) as Record<string, unknown>;
      if (s.room_type !== "org.matrix.msc3815.world") return null;
      const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
      const roomId = str(s.room_id);
      // Joined: the world's own scene picture.
      const room = roomId ? session.rooms.get(roomId) : undefined;
      const state = room ? await room.getStateEvent("org.matrix.msc3815.world").catch(() => undefined) : undefined;
      const scenePreview = str(state?.event?.content?.scene_preview_url);
      return {
        roomId,
        name: str(s.name) ?? str(s.canonical_alias) ?? target,
        topic: str(s.topic),
        members: typeof s.num_joined_members === "number" ? s.num_joined_members : undefined,
        image: scenePreview ?? str(s.avatar_url),
      } as WorldSummary;
    })()
      .then((summary) => !cancelled && setWorld(summary))
      .catch(() => !cancelled && setWorld(null));
    return () => {
      cancelled = true;
    };
  }, [getAuth, session, target, via]);

  if (!world) return null;
  const joined = !!world.roomId && !!session.rooms.get(world.roomId);
  const image = world.image
    ? world.image.startsWith("mxc:")
      ? session.mediaRepository.mxcUrlThumbnail(world.image, 640, 360, "crop") ?? undefined
      : world.image
    : undefined;

  const open = (roomId: string) => {
    selectWorld(roomId);
    setOverlayWindow({ type: OverlayWindow.None });
  };

  const join = async () => {
    setJoining(true);
    setError(undefined);
    try {
      const auth = await getAuth();
      const base = auth.homeserver.replace(/\/+$/, "");
      const params = new URLSearchParams();
      for (const server of via) params.append("server_name", server);
      const res = await fetch(
        `${base}/_matrix/client/v3/join/${encodeURIComponent(target)}${via.length ? `?${params}` : ""}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
          body: "{}",
        }
      );
      const body = (await res.json().catch(() => ({}))) as { room_id?: string; error?: string };
      if (!res.ok || !body.room_id) throw new Error(body.error ?? `Couldn't join (${res.status})`);
      open(body.room_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="ChatEmbed__card">
      <WorldTile
        imageSrc={image}
        fallback={
          <TileFallback name={world.name ?? target} color={`var(--usercolor${getIdentifierColorNumber(target)})`} />
        }
        title={world.name ?? target}
        subtitle={
          <Text variant="b3" color={error ? "danger" : "surface-low"}>
            {error ??
              [
                world.members !== undefined ? `${world.members} member${world.members === 1 ? "" : "s"}` : "World",
                world.topic,
              ]
                .filter(Boolean)
                .join(" · ")}
          </Text>
        }
        action={
          joined ? (
            <Button size="sm" onClick={() => open(world.roomId!)}>
              Open
            </Button>
          ) : (
            <Button size="sm" disabled={joining} onClick={join}>
              {joining ? <Dots size="sm" color="on-primary" /> : "Join World"}
            </Button>
          )
        }
      />
    </div>
  );
}
