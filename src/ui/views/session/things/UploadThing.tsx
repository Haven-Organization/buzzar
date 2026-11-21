/**
 * Buzzar: Upload Thing: add a .glb Thing to My Things (bookmarked in account data, see thingsMatrix.ts), with its
 * name, description and version, saved into the file if you change them (components/file-details).
 */
import { useEffect, useState } from "react";

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
import { saveToThingCollection, ThingCollection } from "../../../utils/thingsMatrix";
import UploadIC from "../../../../../res/ic/upload.svg";

export function UploadThing({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (collection: ThingCollection) => void;
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
      const baked = await details.prepare(file);
      const url = baked ? await uploadMedia(auth, baked, file.name ?? "thing.glb") : fileInfo.mxc;
      onSaved(await saveToThingCollection(auth, session.userId, { url, name: name.trim() || undefined }));
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
              top={<Header left={<HeaderTitle>Upload Thing</HeaderTitle>} />}
              children={
                <Scroll>
                  <div className="flex flex-column gap-md" style={{ padding: "var(--sp-md)" }}>
                    <Text variant="b3" color="surface-low">
                      Upload a .glb object to keep in My Things. A preview is made for you from the file.
                    </Text>
                    <SettingTile label={<Label>Thing</Label>}>
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
                        <FileDetailsFields details={details} descriptionLabel="Description" fileLabel="Thing file" />
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
                        {saving ? "Saving..." : "Add to My Things"}
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
