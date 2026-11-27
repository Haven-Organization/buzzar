/**
 * Buzzar: Upload Item: add a .glb Item to My Items (bookmarked in account data, see itemsMatrix.ts), with its
 * name, description and version, saved into the file if you change them (components/file-details).
 */
import { useEffect, useState } from "react";

import { Switch } from "../../../atoms/button/Switch";
import { editGlbJson, markExtensionUsed, readGlbJson } from "../../../utils/glbMetadata";
import { bakedItemPhysics, itemPhysicsToJSON } from "../../../../plugins/spawnables/itemFile";
import { renderAvatarPreviewFromUrl } from "../../../utils/avatarPreview";
import { Modal } from "../../../atoms/modal/Modal";
import { ModalContent } from "../../../atoms/modal/ModalContent";
import { Content } from "../../../atoms/content/Content";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { Scroll } from "../../../atoms/scroll/Scroll";
import { Footer } from "../../../atoms/footer/Footer";
import { Button } from "../../../atoms/button/Button";
import { Icon } from "../../../atoms/icon/Icon";
import { Input } from "../../../atoms/input/Input";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { AutoFileUpload, AutoUploadInfo } from "../../components/AutoFileUpload";
import { FileDetailsFields, useFileDetails } from "../../components/file-details/FileDetails";
import { useMatrix } from "../../../hooks/useMatrix";
import { getSessionAuth, uploadMedia } from "../../../utils/avatarMatrix";
import { saveToItemCollection, ItemCollection } from "../../../utils/itemsMatrix";
import UploadIC from "../../../../../res/ic/upload.svg";
import { itemExtension, upgradeItemExtension } from "../../../../engine/gltf/itemExtension";

export function UploadItem({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (collection: ItemCollection) => void;
}) {
  const { session, platform, client } = useMatrix(true);
  const [fileInfo, setFileInfo] = useState<AutoUploadInfo>({});
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const details = useFileDetails();
  const { loadFrom, fileMeta } = details;
  const file = fileInfo.blob?.nativeBlob as (Blob & { name?: string }) | undefined;

  useEffect(() => {
    if (file) loadFrom(file);
  }, [file, loadFrom]);

  // Whether it appears in your hold when spawned (HAVEN_item spawn.held), as the file says and as chosen here.
  const [fileHeld, setFileHeld] = useState(false);
  const [held, setHeld] = useState(false);
  // Whether the file already says how it behaves physically (HAVEN_item collider).
  const [fileHasPhysics, setFileHasPhysics] = useState(true);
  useEffect(() => {
    if (!file) return;
    readGlbJson(file)
      .then((json) => {
        const item = itemExtension(json as never) as { spawn?: { held?: unknown }; collider?: unknown } | undefined;
        const value = item?.spawn?.held === true;
        setFileHeld(value);
        setHeld(value);
        setFileHasPhysics(!!item?.collider);
      })
      .catch(() => undefined);
  }, [file]);
  useEffect(() => {
    if (file) setName(fileMeta.name ?? file.name?.replace(/\.glb$/i, "") ?? "");
  }, [file, fileMeta.name]);

  const save = async () => {
    if (!fileInfo.mxc || !file) return;
    setSaving(true);
    setError(undefined);
    try {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) throw new Error("Not signed in");
      let baked = await details.prepare(file);
      // With "Save to file" on, a file that doesn't say how it behaves physically gets Buzzar's own fit (a box round
      // it) written in, so every client handles it the same way.
      const bakePhysics = details.saveToFile && !fileHasPhysics;
      if (held !== fileHeld || bakePhysics) {
        baked = await editGlbJson(baked ?? file, (json) => {
          json.extensions ??= {};
          upgradeItemExtension(json as never);
          const existing = (json.extensions.HAVEN_item ?? {}) as Record<string, unknown>;
          const item = bakePhysics ? itemPhysicsToJSON(bakedItemPhysics(json), existing) : existing;
          item.spawn = { ...((item.spawn as object) ?? {}), held };
          json.extensions.HAVEN_item = item;
          markExtensionUsed(json, "HAVEN_item");
        });
      }
      const url = baked ? await uploadMedia(auth, baked, file.name ?? "item.glb") : fileInfo.mxc;
      // Its picture (as the Items screen draws it), saved with it so the hotbar and tiles can show it.
      let previewUrl: string | undefined;
      try {
        const httpUrl = session.mediaRepository.mxcUrl(url);
        if (httpUrl) {
          const picture = await renderAvatarPreviewFromUrl(url, httpUrl, "item");
          previewUrl = await uploadMedia(auth, picture, "item-preview.png");
        }
      } catch (e) {
        console.warn("Couldn't make a picture of the Item; it's saved without one.", e);
      }
      onSaved(
        await saveToItemCollection(auth, session.userId, {
          url,
          name: name.trim() || undefined,
          preview_url: previewUrl,
        })
      );
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <Content className="grow">
        <ModalContent
          children={
            <Content
              top={<Header left={<HeaderTitle>Upload Item</HeaderTitle>} />}
              children={
                <Scroll>
                  <div className="flex flex-column gap-md" style={{ padding: "var(--sp-md)" }}>
                    <Text variant="b3" color="surface-low">
                      Upload a .glb object to keep in My Items. A preview is made for you from the file.
                    </Text>
                    <SettingTile label={<Label>Item</Label>}>
                      <AutoFileUpload
                        mimeType=".glb"
                        onUploadInfo={setFileInfo}
                        renderButton={(pickFile) => (
                          <Button onClick={pickFile}>
                            <Icon src={UploadIC} color="on-primary" />
                            Choose File
                          </Button>
                        )}
                      />
                    </SettingTile>
                    {file && (
                      <>
                        <SettingTile label={<Label>Name</Label>}>
                          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
                        </SettingTile>
                        <SettingTile
                          label={<Label>Appears in Your Hold</Label>}
                          options={<Switch checked={held} onCheckedChange={setHeld} />}
                        >
                          <Text variant="b3" color="surface-low">
                            For items you carry (a torch, a tool): spawning it puts it straight in your hold instead of
                            setting it down in front of you. Saved into the file.
                          </Text>
                        </SettingTile>
                        <FileDetailsFields details={details} descriptionLabel="Description" fileLabel="Item file" />
                      </>
                    )}
                  </div>
                </Scroll>
              }
              bottom={
                <Footer
                  left={
                    <Button fill="outline" onClick={() => onOpenChange(false)}>
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
                      <Button onClick={save} disabled={saving || !fileInfo.mxc}>
                        {saving ? "Saving..." : "Add to My Items"}
                      </Button>
                    </div>
                  }
                />
              }
            />
          }
        />
      </Content>
    </Modal>
  );
}
