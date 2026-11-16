import { ReactNode, useState } from "react";
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
  AvatarContent,
  fetchProfileAvatar,
  saveToAvatarCollection,
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

  const save = async (scope: "default" | "world") => {
    setSaving(true);
    setError(undefined);
    try {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      const content = await buildContent();
      if (!content) throw new Error("Upload an avatar first");
      // Remember new uploads (and new previews of them) in your Bookmarked avatars.
      if (avatarInfo.mxc || previewInfo.mxc) await saveToAvatarCollection(auth, session.userId, content);

      if (scope === "default") {
        await setProfileAvatar(auth, session.userId, content);
        // Keep Third Room's legacy (private) profile state in sync for compatibility, when that room exists.
        if (profileRoom) {
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

  return (
    <>
      {renderTrigger?.(openModal)}
      <Modal open={isOpen} onOpenChange={setIsOpen}>
        <Content className="grow">
          <ModalContent
            children={
              <Content
                top={<Header left={<HeaderTitle>Upload Avatar</HeaderTitle>} />}
                children={
                  <Scroll>
                    <div className="Edit3DAvatar__content">
                      <Text variant="b3" color="surface-low">
                        Upload a .vrm or .glb avatar and, optionally, a picture of it. Uploads are added to your
                        Bookmarked avatars, so you can wear them again later.
                      </Text>
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
