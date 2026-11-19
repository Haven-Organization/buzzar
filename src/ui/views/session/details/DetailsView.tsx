/**
 * Buzzar: the details page for a world, avatar or Thing, opened from its name on a tile. Avatars and Things get a 3D
 * view you can turn round and zoom; worlds get a large picture, their chat and member list, and (for moderators)
 * their settings. Every page shows what the file says about itself (HAVEN_metadata: author, version, source,
 * description) and facts about the file.
 */
import { ReactNode, useEffect, useState } from "react";
import { Room } from "@thirdroom/hydrogen-view-sdk";
import { useAtom, useAtomValue } from "jotai";

import { Content } from "../../../atoms/content/Content";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { IconButton } from "../../../atoms/button/IconButton";
import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { Scroll } from "../../../atoms/scroll/Scroll";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { SegmentControl } from "../../../atoms/segment-control/SegmentControl";
import { SegmentControlItem } from "../../../atoms/segment-control/SegmentControlItem";
import { Window } from "../../components/window/Window";
import { ModelViewer, LoadedModel } from "../../components/model-viewer/ModelViewer";
import { ChatViewContent } from "../chat/ChatViewContent";
import { MemberListDialog } from "../dialogs/MemberListDialog";
import { InviteDialog } from "../dialogs/InviteDialog";
import { EnterWorldButton } from "../overlay/WorldPreview";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { useRoom } from "../../../hooks/useRoom";
import { useDialog } from "../../../hooks/useDialog";
import { usePowerLevels } from "../../../hooks/usePowerLevels";
import {
  AvatarContent,
  BUILTIN_AVATARS,
  getBuiltinAvatarContent,
  getSessionAuth,
  MatrixAuth,
} from "../../../utils/avatarMatrix";
import { useAvatarWardrobe } from "../../../hooks/useAvatarWardrobe";
import { Dots } from "../../../atoms/loading/Dots";
import { fetchGlbJson } from "../../../utils/chatEmbeds";
import { copyToClipboard } from "../../../utils/common";
import { DirectoryWorld, fetchSuggestedWorld, joinRoomVia, worldLink } from "../../../utils/worldDirectory";
import { AssetMetadata, readAssetMetadata } from "../../../../engine/gltf/assetMetadata";
import { GLTFRoot } from "../../../../engine/gltf/GLTF";
import { DetailsItem, OverlayWindow, overlayWindowAtom } from "../../../state/overlayWindow";
import { worldAtom } from "../../../state/world";
import ArrowBackIC from "../../../../../res/ic/arrow-back.svg";
import CrossIC from "../../../../../res/ic/cross.svg";
import "./DetailsView.css";

/** An mxc:// or app path as something the browser can load. */
function useHttp(url: string | undefined, thumbnail?: { width: number; height: number }) {
  const { session } = useHydrogen(true);
  if (!url) return undefined;
  if (!url.startsWith("mxc:")) return url;
  return (
    (thumbnail && session.mediaRepository.mxcUrlThumbnail(url, thumbnail.width, thumbnail.height, "scale")) ??
    session.mediaRepository.mxcUrl(url) ??
    undefined
  );
}

export function DetailsView() {
  const [overlayWindow, setOverlayWindow] = useAtom(overlayWindowAtom);
  if (overlayWindow.type !== OverlayWindow.Details) return null;
  const { item, back } = overlayWindow;
  const close = () => setOverlayWindow({ type: OverlayWindow.None });
  const goBack = () => setOverlayWindow(back ?? { type: OverlayWindow.None });

  return (
    <Window className="DetailsView" onRequestClose={close}>
      <Content
        top={
          <Header
            left={
              <div className="flex items-center gap-xs">
                <IconButton label="Back" iconSrc={ArrowBackIC} onClick={goBack} />
                <HeaderTitle>
                  {item.kind === "world" ? "World" : item.kind === "avatar" ? "Avatar" : "Thing"}
                </HeaderTitle>
              </div>
            }
            right={<IconButton label="Close" iconSrc={CrossIC} onClick={close} />}
          />
        }
      >
        {item.kind === "world" ? <WorldDetails item={item} /> : <ModelDetails item={item} />}
      </Content>
    </Window>
  );
}

// --- Shared ---------------------------------------------------------------------------------------------------------

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="DetailsView__row flex gap-sm">
      <Text className="DetailsView__label shrink-0" variant="b3" color="surface-low">
        {label}
      </Text>
      <div className="grow">{typeof children === "string" ? <Text variant="b3">{children}</Text> : children}</div>
    </div>
  );
}

/** What the file says about itself. */
function MetadataRows({ meta }: { meta: AssetMetadata }) {
  return (
    <>
      {meta.author && <Row label="Author">{meta.author}</Row>}
      {meta.version && <Row label="Version">{meta.version}</Row>}
      {meta.sourceUrl && (
        <Row label="Source">
          <a href={meta.sourceUrl} target="_blank" rel="noopener noreferrer">
            <Text className="DetailsView__link" variant="b3" color="primary">
              {meta.sourceUrl}
            </Text>
          </a>
        </Row>
      )}
    </>
  );
}

function Description({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <Text className="DetailsView__description" variant="b2">
      {text}
    </Text>
  );
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Facts about a model file, from its glTF JSON. */
export function modelFacts(json: GLTFRoot & { extensions?: Record<string, unknown> }, bytes?: number) {
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives ?? []) {
      const count =
        p.indices !== undefined ? json.accessors?.[p.indices]?.count : json.accessors?.[p.attributes?.POSITION]?.count;
      if ((p.mode ?? 4) === 4 && count) triangles += Math.floor(count / 3);
    }
  }
  const joints = new Set<number>();
  for (const skin of json.skins ?? []) for (const j of skin.joints ?? []) joints.add(j);
  const exts = json.extensions ?? {};
  const motion = exts.HAVEN_avatar_motion as
    | { springs?: { kind?: string }[]; earMotion?: { enabled?: boolean } }
    | undefined;
  const springKinds = new Map<string, number>();
  for (const s of motion?.springs ?? [])
    springKinds.set(s.kind ?? "spring", (springKinds.get(s.kind ?? "spring") ?? 0) + 1);
  const format = exts.VRMC_vrm ? "VRM 1.0" : exts.VRM ? "VRM 0.x" : "glTF binary (.glb)";
  return [
    ["Format", format],
    ...(bytes ? [["File size", formatBytes(bytes)]] : []),
    ["Triangles", triangles.toLocaleString()],
    ...(joints.size ? [["Bones", String(joints.size)]] : []),
    ["Materials", String(json.materials?.length ?? 0)],
    ["Textures", String(json.images?.length ?? 0)],
    ...(motion
      ? [
          [
            "Motion (in file)",
            `${
              Array.from(springKinds)
                .map(([k, n]) => `${n} ${k}`)
                .join(", ") || "no springs"
            }${
              motion.earMotion?.enabled === false
                ? "; idle ear motion off"
                : springKinds.has("ear")
                ? "; idle ear motion"
                : ""
            }`,
          ],
        ]
      : []),
    ...((json.extensionsUsed ?? []).length ? [["Extensions", (json.extensionsUsed ?? []).join(", ")]] : []),
  ] as [string, string][];
}

// --- Avatars and Things ---------------------------------------------------------------------------------------------

function ModelDetails({ item }: { item: Extract<DetailsItem, { kind: "avatar" | "thing" }> }) {
  const fileUrl = useHttp(item.url);
  const previewUrl = useHttp(item.previewUrl, { width: 720, height: 960 });
  const [model, setModel] = useState<LoadedModel>();
  const meta = model ? readAssetMetadata(model.json) : {};
  const name = meta.name ?? item.name;
  const description = meta.description ?? (item.kind === "thing" ? item.description : undefined);

  return (
    <Scroll type="hover">
      <div className="DetailsView__body DetailsView__body--model">
        <div className="DetailsView__stage">
          {fileUrl ? (
            <ModelViewer url={fileUrl} kind={item.kind} onLoaded={setModel} />
          ) : previewUrl ? (
            <img className="DetailsView__image" src={previewUrl} alt="" />
          ) : null}
        </div>
        <div className="DetailsView__info flex flex-column gap-sm">
          <Text variant="h2" weight="semi-bold">
            {name}
          </Text>
          <Description text={description} />
          <div className="flex flex-column gap-xs">
            <MetadataRows meta={meta} />
            {item.kind === "avatar" && item.credit && !meta.author && <Row label="Credit">{item.credit}</Row>}
            {model &&
              modelFacts(model.json, model.bytes).map(([k, v]) => (
                <Row key={k} label={k}>
                  {v}
                </Row>
              ))}
            {!fileUrl && (
              <Text variant="b3" color="surface-low">
                This one is made by Buzzar itself, so there's no file to show.
              </Text>
            )}
          </div>
          {item.kind === "avatar" && <AvatarActions item={item} name={name} />}
          {item.url?.startsWith("mxc:") && (
            <div>
              <Button size="sm" fill="outline" onClick={() => copyToClipboard(item.url!)}>
                Copy File Link
              </Button>
            </div>
          )}
        </div>
      </div>
    </Scroll>
  );
}

/** Wear and Bookmark for an avatar's details page (the same actions as its tile on the Avatars screen). */
function AvatarActions({ item, name }: { item: Extract<DetailsItem, { kind: "avatar" }>; name: string }) {
  const { session } = useHydrogen(true);
  const wardrobe = useAvatarWardrobe();
  const { collection, busy, error, inWorld, wear, bookmark, unbookmark, isBookmarked, isWearing } = wardrobe;

  const builtin = item.builtinId ? BUILTIN_AVATARS.find((a) => a.id === item.builtinId) : undefined;
  const isDefaultRig = item.builtinId === "default";
  const ownUrl = !item.builtinId && item.url?.startsWith("mxc:") ? item.url : undefined;
  if (!isDefaultRig && !builtin && !ownUrl) return null;

  const content: AvatarContent | undefined = ownUrl
    ? {
        url: ownUrl,
        name,
        ...(item.format ? { format: item.format } : {}),
        ...(item.previewUrl?.startsWith("mxc:") ? { preview_url: item.previewUrl } : {}),
      }
    : undefined;
  const getContent = async (auth: MatrixAuth) =>
    builtin ? getBuiltinAvatarContent(auth, session.userId, builtin) : content;
  const wearing = isDefaultRig
    ? isWearing(undefined)
    : builtin
    ? !!collection?.builtin[builtin.id] && isWearing(collection.builtin[builtin.id])
    : isWearing(ownUrl);
  const key = `details:${item.builtinId ?? ownUrl}`;

  return (
    <div className="flex flex-column gap-xs">
      <div className="flex flex-wrap gap-xs">
        {wearing ? (
          <Button size="sm" fill="outline" disabled>
            Wearing
          </Button>
        ) : (
          <Button size="sm" disabled={!!busy} onClick={() => wear(key, "everywhere", getContent)}>
            {busy === key ? <Dots size="sm" color="on-primary" /> : "Wear"}
          </Button>
        )}
        {inWorld && !wearing && (
          <Button size="sm" fill="outline" disabled={!!busy} onClick={() => wear(`${key}:world`, "world", getContent)}>
            {busy === `${key}:world` ? <Dots size="sm" /> : "Wear Only in This World"}
          </Button>
        )}
        {content &&
          (isBookmarked(content.url) ? (
            <Button size="sm" fill="outline" onClick={() => unbookmark(content.url)}>
              Remove Bookmark
            </Button>
          ) : (
            <Button size="sm" fill="outline" onClick={() => bookmark(content)}>
              Bookmark
            </Button>
          ))}
      </div>
      {error && (
        <Text variant="b3" color="danger">
          {error}
        </Text>
      )}
    </div>
  );
}

// --- Worlds ---------------------------------------------------------------------------------------------------------

interface WorldInfo {
  name?: string;
  alias?: string;
  topic?: string;
  members?: number;
  picture?: string;
  sceneUrl?: string;
  hasScript?: boolean;
}

function WorldDetails({ item }: { item: Extract<DetailsItem, { kind: "world" }> }) {
  const { session, platform, client } = useHydrogen(true);
  const [joinedId, setJoinedId] = useState<string>();
  const room = useRoom(session, joinedId ?? item.roomId) as Room | undefined;
  const [info, setInfo] = useState<WorldInfo>({});
  const [meta, setMeta] = useState<AssetMetadata>({});
  const [facts, setFacts] = useState<[string, string][]>([]);
  const [tab, setTab] = useState<"chat" | "members">("chat");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string>();
  const invite = useDialog(false);
  const [, setOverlayWindow] = useAtom(overlayWindowAtom);
  const { worldId, entered } = useAtomValue(worldAtom);

  // What the room says (joined: its own state; otherwise its public summary).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (room) {
        const world = (await room.getStateEvent("org.matrix.msc3815.world").catch(() => undefined)) as any;
        const topic = (await room.getStateEvent("m.room.topic").catch(() => undefined)) as any;
        const content = world?.event?.content ?? {};
        if (cancelled) return;
        setInfo({
          name: room.name ?? undefined,
          alias: room.canonicalAlias ?? undefined,
          topic: typeof topic?.event?.content?.topic === "string" ? topic.event.content.topic : undefined,
          members: room.joinedMemberCount,
          picture:
            typeof content.scene_preview_url === "string" ? content.scene_preview_url : room.avatarUrl ?? undefined,
          sceneUrl: typeof content.scene_url === "string" ? content.scene_url : undefined,
          hasScript: typeof content.script_url === "string",
        });
      } else {
        const auth = await getSessionAuth(platform, client.sessionId);
        if (!auth) return;
        const summary: DirectoryWorld | undefined = await fetchSuggestedWorld(
          auth,
          item.alias ?? item.roomId,
          item.via ?? []
        ).catch(() => undefined);
        if (cancelled || !summary) return;
        setInfo({
          name: summary.name,
          alias: summary.canonical_alias,
          topic: summary.topic,
          members: summary.num_joined_members,
          picture: summary.avatar_url,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room, item, platform, client]);

  // What the world file says about itself (just its JSON, streamed).
  const sceneHttp = useHttp(info.sceneUrl);
  useEffect(() => {
    if (!sceneHttp) return;
    const abort = new AbortController();
    fetchGlbJson(sceneHttp, abort.signal)
      .then((json) => {
        setMeta(readAssetMetadata(json));
        setFacts(modelFacts(json as never).filter(([k]) => k !== "Bones" && k !== "Motion (in file)"));
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [sceneHttp]);

  const picture = useHttp(info.picture, { width: 1280, height: 720 });
  const isHere = entered && worldId === room?.id;
  const name = info.name || meta.name || info.alias || item.alias || item.roomId;

  const join = async () => {
    setJoining(true);
    setError(undefined);
    try {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      setJoinedId(await joinRoomVia(auth, item.alias ?? item.roomId, item.via ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="DetailsView__world flex">
      {room && (
        <Dialog open={invite.open} onOpenChange={invite.setOpen}>
          <InviteDialog roomId={room.id} requestClose={invite.closeDialog} />
        </Dialog>
      )}
      <Scroll type="hover" className="DetailsView__worldInfo">
        <div className="DetailsView__body flex flex-column gap-sm">
          {picture && <img className="DetailsView__worldImage" src={picture} alt="" />}
          <Text variant="h2" weight="semi-bold">
            {name}
          </Text>
          <div className="flex flex-wrap gap-xs">
            {room ? (
              isHere ? (
                <Text variant="b3" color="surface-low">
                  You're here
                </Text>
              ) : (
                <EnterWorldButton room={room} size="sm" label="Enter" />
              )
            ) : (
              <Button size="sm" disabled={joining} onClick={join}>
                {joining ? "Joining…" : "Join"}
              </Button>
            )}
            {room && (
              <Button size="sm" fill="outline" onClick={invite.openDialog}>
                Invite
              </Button>
            )}
            {room && (
              <SettingsButton
                room={room}
                onOpen={() => setOverlayWindow({ type: OverlayWindow.WorldSettings, roomId: room.id })}
              />
            )}
            <Button size="sm" fill="outline" onClick={() => copyToClipboard(worldLink(info.alias ?? item.roomId))}>
              Copy Link
            </Button>
          </div>
          {error && (
            <Text variant="b3" color="danger">
              {error}
            </Text>
          )}
          <Description text={info.topic} />
          {meta.description && meta.description !== info.topic && <Description text={meta.description} />}
          <div className="flex flex-column gap-xs">
            {info.alias && <Row label="Address">{info.alias}</Row>}
            {info.members !== undefined && <Row label="Members">{String(info.members)}</Row>}
            <MetadataRows meta={meta} />
            {info.hasScript !== undefined && <Row label="Script">{info.hasScript ? "Yes" : "None"}</Row>}
            {facts.map(([k, v]) => (
              <Row key={k} label={k}>
                {v}
              </Row>
            ))}
          </div>
        </div>
      </Scroll>
      <div className="DetailsView__worldSide flex flex-column">
        {room ? (
          <>
            <div className="DetailsView__tabs">
              <SegmentControl>
                <SegmentControlItem value="chat" isSelected={tab === "chat"} onSelect={setTab}>
                  Chat
                </SegmentControlItem>
                <SegmentControlItem value="members" isSelected={tab === "members"} onSelect={setTab}>
                  Members
                </SegmentControlItem>
              </SegmentControl>
            </div>
            <div className="DetailsView__panel grow flex flex-column">
              {tab === "chat" ? <ChatViewContent room={room} /> : <MemberListDialog room={room} embedded />}
            </div>
          </>
        ) : (
          <div className="grow flex items-center justify-center">
            <Text variant="b3" color="surface-low">
              Join this world to see its chat and members.
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}

/** World settings, for those allowed to change them (moderators and admins). */
function SettingsButton({ room, onOpen }: { room: Room; onOpen: () => void }) {
  const { session } = useHydrogen(true);
  const { getPowerLevel, canSendStateEvent } = usePowerLevels(room);
  if (!canSendStateEvent(undefined, getPowerLevel(session.userId))) return null;
  return (
    <Button size="sm" fill="outline" onClick={onOpen}>
      Settings
    </Button>
  );
}
