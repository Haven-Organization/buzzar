import { useCallback, useState, FormEvent, ChangeEvent, ReactNode, useEffect } from "react";
import { RoomVisibility, IBlobHandle, RoomType, Session, StateEvent } from "@thirdroom/hydrogen-view-sdk";

import { Text } from "../../../atoms/text/Text";
import { Button } from "../../../atoms/button/Button";
import { Switch } from "../../../atoms/button/Switch";
import { Label } from "../../../atoms/text/Label";
import { Input } from "../../../atoms/input/Input";
import { Scroll } from "../../../atoms/scroll/Scroll";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { getMxIdDomain, isRoomAliasAvailable, waitToCreateRoom } from "../../../utils/matrixUtils";
import { getImageDimension } from "../../../utils/common";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { useDebounce } from "../../../hooks/useDebounce";
import { useIsMounted } from "../../../hooks/useIsMounted";
import { Footer } from "../../../atoms/footer/Footer";
import { Content } from "../../../atoms/content/Content";
import { AvatarPicker } from "../../components/avatar-picker/AvatarPicker";
import { useFilePicker } from "../../../hooks/useFilePicker";
import defaultWorlds from "../../../../../res/defaultWorlds.json";
import { Thumbnail } from "../../../atoms/thumbnail/Thumbnail";
import { ThumbnailImg } from "../../../atoms/thumbnail/ThumbnailImg";
import { getHttpUrl } from "../../../utils/avatar";
import { getSessionAuth, uploadMedia } from "../../../utils/avatarMatrix";
import { fetchGlbJson } from "../../../utils/chatEmbeds";
import { readAssetMetadata } from "../../../../engine/gltf/assetMetadata";
import { FileDetailsFields, useFileDetails } from "../../components/file-details/FileDetails";
import { isBundledPath, uploadBundledFile } from "../../../utils/bundledMedia";
import { UploadScene } from "./UploadScene";
import { MAX_OBJECT_CAP } from "../../../../engine/config.common";
import "./CreateWorldForm.css";
import { AutoFileUpload, AutoUploadInfo } from "../../components/AutoFileUpload";
import { Icon } from "../../../atoms/icon/Icon";
import UploadIC from "../../../../../res/ic/upload.svg";

export function AliasAvailabilityProvider({
  session,
  children,
}: {
  session: Session;
  children: (
    available: boolean | undefined,
    handleAliasChange: (evt: ChangeEvent<HTMLInputElement>) => void
  ) => ReactNode;
}) {
  const { homeserver } = session.sessionInfo;
  const userHSDomain = getMxIdDomain(session.userId);
  const isMounted = useIsMounted();
  const [available, setAvailable] = useState<boolean>();

  const debouncedAliasChange = useCallback(
    async (evt: ChangeEvent<HTMLInputElement>) => {
      if (!isMounted()) return;
      setAvailable(undefined);
      if (evt.target.value.trim() === "") return;

      const value = evt.target.value.replace(/\s/g, "-");
      if (evt.target.value !== value) evt.target.value = value;
      const isAvail = await isRoomAliasAvailable(homeserver, `#${value}:${userHSDomain}`);

      if (evt.target.value !== value) return;
      if (!isMounted()) return;
      setAvailable(isAvail);
    },
    [homeserver, userHSDomain, isMounted]
  );

  const handleAliasChange = useDebounce(debouncedAliasChange, { wait: 300, immediate: true });
  return <>{children(available, handleAliasChange)}</>;
}

export type CreateWorldContent = {
  scene_url: string;
  scene_preview_url: string;
  max_member_object_cap?: number;
  script_url?: string;
} & Record<string, any>;
/** Buzzar: a scene to create the world with; `file` when it was just picked from disk. */
interface SceneChoice {
  url: string;
  previewUrl: string;
  file?: Blob;
}

export interface CreateWorldOptions {
  avatar?: IBlobHandle;
  name: string;
  topic?: string;
  visibility: RoomVisibility;
  alias?: string;
  content: CreateWorldContent;
}

export async function createWorld(
  session: Session,
  { avatar, name, topic, visibility, alias, content }: CreateWorldOptions
) {
  const avatarInfo = !avatar
    ? undefined
    : {
        name: avatar.nativeBlob.name,
        blob: avatar,
        info: {
          mimetype: avatar.nativeBlob.type,
          size: avatar.size,
          ...(await getImageDimension(avatar.nativeBlob)),
        },
      };

  const roomBeingCreated = await session.createRoom({
    type: RoomType.World,
    visibility,
    avatar: avatarInfo,
    name,
    topic,
    alias,
    isEncrypted: false,
    isFederationDisabled: false,
    powerLevelContentOverride: {
      invite: 100,
      kick: 100,
      ban: 100,
      redact: 50,
      state_default: 50,
      events_default: 0,
      users_default: 0,
      events: {
        "m.room.power_levels": 100,
        "m.room.history_visibility": 100,
        "m.room.tombstone": 100,
        "m.room.encryption": 100,
        "m.room.name": 50,
        "m.room.message": 0,
        "m.room.encrypted": 50,
        "m.sticker": 50,
        "org.matrix.msc3815.world": 50,
        "org.matrix.msc3401.call": 0,
        "org.matrix.msc3401.call.member": 0,
        "org.matrix.msc3815.member.world": 0,
      },
      // Buzzar: no `users` entry. The server already gives the creator PL 100, and room v12 (matrix.org's
      // current default) rejects power levels that list a creator.
    },
    initialState: [
      {
        type: "org.matrix.msc3815.world",
        content,
      },
    ],
  });

  return roomBeingCreated;
}

export interface CreateWorldFormProps {
  scene?: {
    roomId: string;
    event: StateEvent;
  };
  /** Buzzar: a scene to start with (mxc URLs), e.g. a world file posted in chat. */
  initialScene?: { url: string; previewUrl: string };
  onSceneChange?: (sceneUrl?: string, scenePreviewUrl?: string) => void;
  onCreate: (roomId: string) => void;
  onClose: () => void;
}
export function CreateWorldForm({ scene, initialScene, onSceneChange, onCreate, onClose }: CreateWorldFormProps) {
  const { session, platform, client } = useHydrogen(true);
  const userHSDomain = getMxIdDomain(session.userId);
  const isMounted = useIsMounted();

  const { fileData: avatarData, pickFile: pickAvatar, dropFile: dropAvatar } = useFilePicker(platform, "image/*");

  const eventSceneUrl = scene?.event?.content.scene.url;
  const eventPreviewUrl = scene?.event?.content.scene.preview_url;
  const controlledScene =
    typeof eventSceneUrl === "string" && typeof eventPreviewUrl === "string"
      ? {
          url: eventSceneUrl,
          previewUrl: eventPreviewUrl,
        }
      : initialScene;

  const [uploadScene, setUploadScene] = useState<SceneChoice | undefined>(controlledScene);
  const [selectedScene, setSelectedScene] = useState<SceneChoice | undefined>(controlledScene);
  // Buzzar: the world file's own Topic (description) and Version, saved back into it on create if changed.
  const details = useFileDetails();
  const { loadFrom } = details;
  useEffect(() => {
    if (!selectedScene) return;
    let cancelled = false;
    (async () => {
      if (selectedScene.file) return loadFrom(selectedScene.file);
      const url = isBundledPath(selectedScene.url)
        ? selectedScene.url
        : session.mediaRepository.mxcUrl(selectedScene.url);
      if (!url) return;
      const json = await fetchGlbJson(url);
      if (!cancelled) await loadFrom(readAssetMetadata(json));
    })().catch((e) => console.warn("Couldn't read the world file's details", e));
    return () => {
      cancelled = true;
    };
  }, [selectedScene, loadFrom, session]);
  const [scriptInfo, setScriptInfo] = useState<AutoUploadInfo>({});
  const [creatingRoom, setCreatingRoom] = useState(false);

  const [createError, setCreateError] = useState<string>();

  // Buzzar: bundled starter scenes (public/worlds/…) are uploaded to the user's own homeserver first.
  const uploadBundledScene = async (content: CreateWorldContent) => {
    if (!isBundledPath(content.scene_url) && !isBundledPath(content.scene_preview_url)) return content;
    const auth = await getSessionAuth(platform, client.sessionId);
    if (!auth) throw new Error("Not signed in");
    const [scene, preview] = await Promise.all([
      isBundledPath(content.scene_url) ? uploadBundledFile(auth, content.scene_url) : { url: content.scene_url },
      isBundledPath(content.scene_preview_url)
        ? uploadBundledFile(auth, content.scene_preview_url)
        : { url: content.scene_preview_url },
    ]);
    return { ...content, scene_url: scene.url, scene_preview_url: preview.url };
  };

  /** Buzzar: with "Save Topic and Version" on and changes typed, upload a copy of the scene with them written in. */
  const saveDetailsIntoScene = async (content: CreateWorldContent): Promise<CreateWorldContent> => {
    if (!details.willSave || !selectedScene) return content;
    let file = selectedScene.file;
    if (!file) {
      const url = isBundledPath(content.scene_url)
        ? content.scene_url
        : session.mediaRepository.mxcUrl(content.scene_url);
      if (!url) return content;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn't download the world file to save its details (${res.status})`);
      file = await res.blob();
    }
    const baked = await details.prepare(file);
    if (!baked) return content;
    const auth = await getSessionAuth(platform, client.sessionId);
    if (!auth) throw new Error("Not signed in");
    return { ...content, scene_url: await uploadMedia(auth, baked, "world.glb") };
  };

  const handleCreateWorld = async (options: CreateWorldOptions) => {
    setCreatingRoom(true);
    setCreateError(undefined);
    try {
      options = { ...options, content: await uploadBundledScene(await saveDetailsIntoScene(options.content)) };
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
      setCreatingRoom(false);
      return;
    }
    const roomBeingCreated = await createWorld(session, options);
    const room = await waitToCreateRoom(session, roomBeingCreated);
    if (room && isMounted()) {
      onCreate(room.id);
      setCreatingRoom(false);
    }
  };

  const handleSubmit = (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    if (!selectedScene) return;
    const { nameInput, isPrivateInput, aliasInput, maxObjectCapInput } = evt.target as typeof evt.target & {
      nameInput: HTMLInputElement;
      isPrivateInput: HTMLInputElement;
      aliasInput: HTMLInputElement;
      maxObjectCapInput: HTMLInputElement;
    };
    const alias = aliasInput.getAttribute("data-ui-state") === "error" ? undefined : aliasInput.value || undefined;
    const content: CreateWorldContent = {
      scene_url: selectedScene.url,
      scene_preview_url: selectedScene.previewUrl,
      max_member_object_cap: parseInt(maxObjectCapInput.value) || undefined,
    };
    if (scriptInfo.mxc) {
      content.script_url = scriptInfo.mxc;
    }
    if (controlledScene && scene) {
      content.scene = scene.event.content.scene;
      content.scene_from = {
        state_key: scene.event.state_key ?? undefined,
        room_id: scene.roomId,
      };
    }
    handleCreateWorld({
      visibility: isPrivateInput.checked ? RoomVisibility.Private : RoomVisibility.Public,
      name: nameInput.value,
      topic: details.description.trim() || undefined,
      avatar: avatarData.blob,
      alias,
      content,
    });
  };

  useEffect(() => {
    onSceneChange?.(selectedScene?.url, selectedScene?.previewUrl);
  }, [selectedScene, onSceneChange]);

  const renderSceneSelector = (sceneUrl: string, previewUrl: string, roomAvatarUrl?: string, file?: Blob) => (
    <button
      key={sceneUrl}
      className="flex"
      style={{ cursor: "pointer" }}
      onClick={() => {
        setSelectedScene({ url: sceneUrl, previewUrl, file });
      }}
      type="button"
    >
      <Thumbnail outlined={selectedScene?.url === sceneUrl} className="shrink-0" size="sm">
        <ThumbnailImg
          src={
            isBundledPath(roomAvatarUrl ?? previewUrl)
              ? roomAvatarUrl ?? previewUrl
              : // Buzzar: a server-made thumbnail, not the full-size picture (Third Room #301).
                session.mediaRepository.mxcUrlThumbnail(roomAvatarUrl ?? previewUrl, 160, 160, "crop") ??
                getHttpUrl(session, roomAvatarUrl ?? previewUrl)!
          }
        />
      </Thumbnail>
    </button>
  );

  return (
    <Content
      onSubmit={handleSubmit}
      children={
        <Scroll>
          <div className="CreateWorldForm">
            {controlledScene ? null : (
              <SettingTile label={<Label>Scenes *</Label>}>
                <Scroll orientation="horizontal" type="hover">
                  <div className="flex items-center gap-md">
                    {uploadScene &&
                      renderSceneSelector(uploadScene.url, uploadScene.previewUrl, undefined, uploadScene.file)}
                    <UploadScene
                      onSave={(sceneUrl, previewUrl, file) => {
                        setUploadScene({ url: sceneUrl, previewUrl, file });
                        setSelectedScene({ url: sceneUrl, previewUrl, file });
                      }}
                      renderTrigger={(openModal) => (
                        <AvatarPicker onAvatarPick={openModal} onAvatarDrop={() => false} />
                      )}
                    />
                    <div
                      className="shrink-0"
                      style={{ backgroundColor: "var(--bg-surface-border)", height: "40px", width: "2px" }}
                    />
                    {defaultWorlds.scenes.map((scene) =>
                      renderSceneSelector(scene.sceneUrl, scene.scenePreviewUrl, scene.defaultRoomAvatarUrl)
                    )}
                  </div>
                </Scroll>
              </SettingTile>
            )}
            <SettingTile label={<Label>World Name *</Label>}>
              <Input name="nameInput" required />
            </SettingTile>
            <FileDetailsFields details={details} descriptionLabel="Topic" fileLabel="world file" />
            <div className="flex gap-lg">
              <AliasAvailabilityProvider session={session}>
                {(isAliasAvail, handleAliasChange) => (
                  <SettingTile
                    className="grow basis-0"
                    label={
                      <Label color={isAliasAvail ? "secondary" : isAliasAvail === false ? "danger" : undefined}>
                        {isAliasAvail
                          ? "Alias (Available)"
                          : isAliasAvail === false
                          ? "Alias (Already in use)"
                          : "Alias"}
                      </Label>
                    }
                  >
                    <Input
                      name="aliasInput"
                      state={isAliasAvail ? "success" : isAliasAvail === false ? "error" : undefined}
                      onChange={handleAliasChange}
                      maxLength={255 - (userHSDomain.length + 2) /*for -> #:*/}
                      before={<Text variant="b2">#</Text>}
                      after={<Text variant="b2">{`:${userHSDomain}`}</Text>}
                    />
                  </SettingTile>
                )}
              </AliasAvailabilityProvider>
              <SettingTile className="grow basis-0" label={<Label>Max Spawned Objects Per User</Label>}>
                <Input name="maxObjectCapInput" type="number" defaultValue={MAX_OBJECT_CAP} required />
              </SettingTile>
            </div>
            <div className="flex gap-lg">
              <SettingTile className="grow basis-0" label={<Label>Private</Label>}>
                <Switch name="isPrivateInput" defaultChecked={true} />
              </SettingTile>
              <SettingTile className="grow basis-0" label={<Label>Script (EXPERIMENTAL)</Label>}>
                <AutoFileUpload
                  mimeType=".js,.wasm"
                  onUploadInfo={setScriptInfo}
                  renderButton={(pickFile) => (
                    <Button fill="outline" onClick={pickFile}>
                      <Icon src={UploadIC} color="primary" />
                      Upload Script
                    </Button>
                  )}
                />
              </SettingTile>
            </div>
            <SettingTile label={<Label>World Avatar</Label>}>
              <AvatarPicker url={avatarData.url} onAvatarPick={pickAvatar} onAvatarDrop={dropAvatar} />
            </SettingTile>
          </div>
        </Scroll>
      }
      bottom={
        <Footer
          left={
            <Button size="lg" fill="outline" onClick={onClose}>
              Cancel
            </Button>
          }
          right={
            <div className="flex items-center gap-sm">
              {createError && (
                <Text variant="b3" color="danger">
                  {createError}
                </Text>
              )}
              <Button size="lg" type="submit" disabled={!selectedScene || creatingRoom}>
                {creatingRoom ? "Creating World..." : "Create World"}
              </Button>
            </div>
          }
        />
      }
    />
  );
}
