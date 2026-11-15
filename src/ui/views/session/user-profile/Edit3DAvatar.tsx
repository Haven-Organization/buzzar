import { ReactNode, useEffect, useState } from "react";
import { useAtomValue } from "jotai";

import { Modal } from "../../../atoms/modal/Modal";
import { ModalContent } from "../../../atoms/modal/ModalContent";
import { ModalAside } from "../../../atoms/modal/ModalAside";
import { Text } from "../../../atoms/text/Text";
import { ScenePreview } from "../../components/scene-preview/ScenePreview";
import { Button } from "../../../atoms/button/Button";
import { Content } from "../../../atoms/content/Content";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { Scroll } from "../../../atoms/scroll/Scroll";
import "./Edit3DAvatar.css";
import { Footer } from "../../../atoms/footer/Footer";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { AutoFileUpload, AutoUploadInfo } from "../../components/AutoFileUpload";
import { Label } from "../../../atoms/text/Label";
import { Icon } from "../../../atoms/icon/Icon";
import UploadIC from "../../../../../res/ic/upload.svg";
import { worldAtom } from "../../../state/world";
import { refreshWorldAvatar } from "../../../../engine/avatar/avatar.main";
import {
  AvatarCollection,
  AvatarContent,
  BUILTIN_AVATARS,
  BuiltinAvatar,
  fetchAvatarCollection,
  fetchProfileAvatar,
  fetchWorldAvatar,
  removeFromAvatarCollection,
  SavedAvatar,
  saveToAvatarCollection,
  getBuiltinAvatarContent,
  getSessionAuth,
  setProfileAvatar,
  setWorldAvatar,
} from "../../../utils/avatarMatrix";

interface Edit3DAvatarProps {
  renderTrigger?: (openModal: () => void) => ReactNode;
  /** Controlled mode (e.g. opened from a dropdown menu that unmounts). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Edit3DAvatar({ renderTrigger, open, onOpenChange }: Edit3DAvatarProps) {
  const { session, profileRoom, client, platform } = useHydrogen(true);
  const world = useAtomValue(worldAtom);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const setIsOpen = (value: boolean) => {
    setUncontrolledOpen(value);
    onOpenChange?.(value);
  };
  const openModal = () => setIsOpen(true);
  const closeModal = () => setIsOpen(false);
  const [avatarInfo, setAvatarInfo] = useState<AutoUploadInfo>({});
  const [previewInfo, setPreviewInfo] = useState<AutoUploadInfo>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const inWorld = world.entered && !!world.worldId;
  const [collection, setCollection] = useState<AvatarCollection>();
  /** What you're wearing: your default (profile) avatar, and this world's own choice that overrides it. */
  const [wearing, setWearing] = useState<{ profile?: AvatarContent; world?: AvatarContent }>();

  // Buzzar: the personal collection of uploaded avatars (account data), so earlier uploads can be worn again.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) return;
      const [loaded, profile, worldAvatar] = await Promise.all([
        fetchAvatarCollection(auth, session.userId).catch(() => undefined),
        fetchProfileAvatar(auth, session.userId).catch(() => undefined),
        inWorld ? fetchWorldAvatar(auth, world.worldId!, session.userId).catch(() => undefined) : undefined,
      ]);
      if (cancelled) return;
      if (loaded) setCollection(loaded);
      setWearing({ profile, world: worldAvatar });
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, platform, client, session, inWorld, world.worldId]);

  /** Merge newly uploaded files with the current default avatar. */
  const buildContent = async (): Promise<AvatarContent | undefined> => {
    const auth = await getSessionAuth(platform, client.sessionId);
    const current = auth ? await fetchProfileAvatar(auth, session.userId) : undefined;
    const url = avatarInfo.mxc ?? current?.url;
    if (!url) return undefined;
    const name = avatarInfo.blob?.nativeBlob?.name as string | undefined;
    return {
      url,
      preview_url: previewInfo.mxc ?? (avatarInfo.mxc ? undefined : current?.preview_url),
      // Advisory only: the engine detects VRM 0.x/1.0 from the file itself.
      format: avatarInfo.mxc ? (name?.toLowerCase().endsWith(".vrm") ? undefined : "glb") : current?.format,
      name: name ?? current?.name,
    };
  };

  const avatarLabel = (avatar?: AvatarContent) => avatar?.name || (avatar ? "Uploaded avatar" : "Built-in default");

  /** Drops this world's own avatar choice, so your default avatar applies here again. */
  const clearWorldAvatar = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      await setWorldAvatar(auth, world.worldId!, session.userId, undefined);
      refreshWorldAvatar(session.userId);
      setWearing((w) => ({ ...w, world: undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  /** `content` undefined = reset to the built-in default avatar. */
  const apply = async (scope: "default" | "world", getContent: () => Promise<AvatarContent | undefined>) => {
    setSaving(true);
    setError(undefined);
    try {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      const content = await getContent();

      if (scope === "default") {
        await setProfileAvatar(auth, session.userId, content);
        // Keep Third Room's legacy (private) profile state in sync for compatibility, when that room exists.
        if (profileRoom && content) {
          await session.hsApi.sendState(profileRoom.id, "org.matrix.msc3815.world.profile", "", {
            avatar_url: content.url,
            avatar_preview_url: content.preview_url,
          });
        }
      }
      // Profile changes aren't pushed to other clients live, so also update the world we're in.
      if (inWorld) {
        await setWorldAvatar(auth, world.worldId!, session.userId, content);
        refreshWorldAvatar(session.userId);
      }
      closeModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const save = (scope: "default" | "world") =>
    apply(scope, async () => {
      const content = await buildContent();
      if (!content) throw new Error("Upload an avatar first");
      // Remember new uploads (and new previews of them) in the collection.
      if (avatarInfo.mxc || previewInfo.mxc) {
        const auth = await getSessionAuth(platform, client.sessionId);
        if (auth) await saveToAvatarCollection(auth, session.userId, content);
      }
      return content;
    });

  const wearSaved = (avatar: SavedAvatar) =>
    apply(inWorld ? "world" : "default", async () => {
      const { added_ts: _added, ...content } = avatar;
      return content;
    });

  const removeSaved = async (avatar: SavedAvatar) => {
    setError(undefined);
    try {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      setCollection(await removeFromAvatarCollection(auth, session.userId, avatar.url));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const applyBuiltin = (avatar: BuiltinAvatar | undefined) =>
    apply(inWorld ? "world" : "default", async () => {
      if (!avatar) return undefined;
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      return getBuiltinAvatarContent(auth, session.userId, avatar);
    });

  return (
    <>
      {renderTrigger?.(openModal)}
      <Modal open={isOpen} onOpenChange={setIsOpen}>
        <Content className="grow">
          <ModalContent
            children={
              <Content
                top={<Header left={<HeaderTitle>Edit 3D Avatar</HeaderTitle>} />}
                children={
                  <Scroll>
                    <div className="Edit3DAvatar__content">
                      <SettingTile className="grow basis-0" label={<Label>Wearing</Label>}>
                        {wearing ? (
                          <div className="flex flex-column gap-xs">
                            <Text variant="b2">Default: {avatarLabel(wearing.profile)}</Text>
                            {inWorld && wearing.world && wearing.world.url !== wearing.profile?.url && (
                              <div className="flex items-center gap-xs">
                                <Text className="grow" variant="b2">
                                  This world only: {avatarLabel(wearing.world)}
                                </Text>
                                <Button size="sm" fill="outline" disabled={saving} onClick={clearWorldAvatar}>
                                  Use Default Here
                                </Button>
                              </div>
                            )}
                            <Text variant="b3" color="surface-low">
                              {inWorld
                                ? "Changes here apply to this world right away; Save as Default also changes your default."
                                : "Worlds where you chose an avatar just for that world keep it until you change it there."}
                            </Text>
                          </div>
                        ) : (
                          <Text variant="b3" color="surface-low">
                            Loading…
                          </Text>
                        )}
                      </SettingTile>
                      <SettingTile className="grow basis-0" label={<Label>Built-in Avatars</Label>}>
                        <div className="flex gap-xs items-center">
                          <Button fill="outline" disabled={saving} onClick={() => applyBuiltin(undefined)}>
                            Default
                          </Button>
                          {BUILTIN_AVATARS.map((avatar) => (
                            <Button
                              key={avatar.id}
                              fill="outline"
                              disabled={saving}
                              onClick={() => applyBuiltin(avatar)}
                            >
                              {avatar.name}
                            </Button>
                          ))}
                        </div>
                        <Text variant="b3" color="surface-low">
                          {inWorld ? "Switches your avatar in this world right away." : "Sets your default avatar."}{" "}
                          Built-in avatars by Polygonal Mind (CC0).
                        </Text>
                      </SettingTile>
                      <SettingTile className="grow basis-0" label={<Label>Your Avatars</Label>}>
                        {collection && collection.avatars.length > 0 ? (
                          <div className="Edit3DAvatar__saved flex flex-column gap-xs">
                            {collection.avatars.map((avatar) => (
                              <div key={avatar.url} className="flex items-center gap-xs">
                                <Text className="grow truncate" variant="b2">
                                  {avatar.name ||
                                    `Avatar from ${new Date(avatar.added_ts || Date.now()).toLocaleDateString()}`}
                                </Text>
                                <Button size="sm" fill="outline" disabled={saving} onClick={() => wearSaved(avatar)}>
                                  Wear
                                </Button>
                                <Button
                                  size="sm"
                                  fill="none"
                                  variant="danger"
                                  disabled={saving}
                                  onClick={() => removeSaved(avatar)}
                                >
                                  Remove
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <Text variant="b3" color="surface-low">
                            {collection ? "Avatars you upload are saved here, so you can wear them again." : "Loading…"}
                          </Text>
                        )}
                      </SettingTile>
                      <SettingTile className="grow basis-0" label={<Label>Avatar</Label>}>
                        <AutoFileUpload
                          mimeType=".glb,.vrm"
                          onUploadInfo={setAvatarInfo}
                          renderButton={(pickFile) => (
                            <Button onClick={pickFile}>
                              <Icon src={UploadIC} color="on-primary" />
                              Upload Avatar
                            </Button>
                          )}
                        />
                      </SettingTile>
                      <SettingTile className="grow basis-0" label={<Label>Avatar Preview</Label>}>
                        <AutoFileUpload
                          mimeType="image/*"
                          onUploadInfo={setPreviewInfo}
                          renderButton={(pickFile) => (
                            <Button onClick={pickFile}>
                              <Icon src={UploadIC} color="on-primary" />
                              Upload Preview
                            </Button>
                          )}
                        />
                      </SettingTile>
                    </div>
                  </Scroll>
                }
                bottom={
                  <Footer
                    left={
                      <Button onClick={closeModal} fill="outline">
                        Cancel
                      </Button>
                    }
                    right={
                      <div className="flex gap-xs items-center">
                        {error && (
                          <Text variant="b3" color="danger">
                            {error}
                          </Text>
                        )}
                        {inWorld && (
                          <Button
                            fill="outline"
                            onClick={() => save("world")}
                            disabled={saving || (!avatarInfo.mxc && !previewInfo.mxc)}
                          >
                            Use Only in This World
                          </Button>
                        )}
                        <Button
                          onClick={() => save("default")}
                          disabled={saving || (!avatarInfo.mxc && !previewInfo.mxc)}
                        >
                          {saving ? "Saving..." : "Save as Default"}
                        </Button>
                      </div>
                    }
                  />
                }
              />
            }
            aside={
              <ModalAside className="flex">
                <ScenePreview
                  className="grow"
                  src={previewInfo.url}
                  alt="3D Avatar preview"
                  fallback={
                    <Text variant="b3" color="surface-low" weight="medium">
                      Uploaded avatar preview will appear here.
                    </Text>
                  }
                />
              </ModalAside>
            }
          />
        </Content>
      </Modal>
    </>
  );
}
