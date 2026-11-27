/**
 * Buzzar: the Description (or Topic) and Version fields on the upload screens for worlds, avatars and Items, and the
 * "Save to file" switch. Picking a file fills the fields from what the file says about itself (HAVEN_metadata);
 * with the switch on, anything typed that differs from the file is written into it before it's uploaded
 * (utils/glbMetadata).
 */
import { useCallback, useState } from "react";

import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { Input } from "../../../atoms/input/Input";
import { Textarea } from "../../../atoms/input/Textarea";
import { Switch } from "../../../atoms/button/Switch";
import { SettingTile } from "../setting-tile/SettingTile";
import { AssetMetadata } from "../../../../engine/gltf/assetMetadata";
import { bakeFileMetadata, metadataDiffers, readFileMetadata } from "../../../utils/glbMetadata";
import "./FileDetails.css";

export interface FileDetailsState {
  description: string;
  version: string;
  saveToFile: boolean;
  /** What the picked file says about itself. */
  fileMeta: AssetMetadata;
  setDescription: (value: string) => void;
  setVersion: (value: string) => void;
  setSaveToFile: (value: boolean) => void;
  /** Fill the fields from a picked file (or from details read some other way, e.g. a file already uploaded). */
  loadFrom: (source: Blob | AssetMetadata | undefined) => Promise<void>;
  /**
   * The file to upload: `blob` with the typed details written in, if the switch is on and they differ from the
   * file's own; otherwise undefined (upload the file as it is).
   */
  prepare: (blob: Blob) => Promise<Blob | undefined>;
  /** Whether prepare() would write anything. */
  willSave: boolean;
}

export function useFileDetails(): FileDetailsState {
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("");
  const [saveToFile, setSaveToFile] = useState(true);
  const [fileMeta, setFileMeta] = useState<AssetMetadata>({});

  const loadFrom = useCallback(async (source: Blob | AssetMetadata | undefined) => {
    const meta = !source ? {} : source instanceof Blob ? await readFileMetadata(source) : source;
    setFileMeta(meta);
    if (meta.description) setDescription(meta.description);
    if (meta.version) setVersion(meta.version);
  }, []);

  const willSave = saveToFile && metadataDiffers(fileMeta, { description, version });
  const prepare = useCallback(
    async (blob: Blob) => (willSave ? bakeFileMetadata(blob, { description, version }) : undefined),
    [willSave, description, version]
  );

  return {
    description,
    version,
    saveToFile,
    fileMeta,
    setDescription,
    setVersion,
    setSaveToFile,
    loadFrom,
    prepare,
    willSave,
  };
}

export function FileDetailsFields({
  details,
  descriptionLabel = "Description",
  fileLabel = "file",
}: {
  details: FileDetailsState;
  descriptionLabel?: string;
  fileLabel?: string;
}) {
  return (
    <div className="FileDetails flex flex-column gap-md">
      <SettingTile label={<Label>{descriptionLabel}</Label>}>
        <Textarea
          className="FileDetails__description"
          value={details.description}
          onChange={(e) => details.setDescription(e.target.value)}
          rows={4}
          maxLength={10000}
        />
      </SettingTile>
      <div className="flex gap-lg items-end">
        <SettingTile className="grow basis-0" label={<Label>Version</Label>}>
          <Input
            value={details.version}
            onChange={(e) => details.setVersion(e.target.value)}
            placeholder="0.1.0"
            maxLength={100}
          />
        </SettingTile>
        <SettingTile
          className="grow basis-0"
          label={<Label>{`Save ${descriptionLabel} and Version to ${fileLabel}`}</Label>}
        >
          <Switch checked={details.saveToFile} onCheckedChange={details.setSaveToFile} />
        </SettingTile>
      </div>
      <Text variant="b3" color="surface-low">
        {details.saveToFile
          ? details.willSave
            ? `What you've typed will be written into the ${fileLabel} before it's uploaded, so it goes wherever the ${fileLabel} goes.`
            : `Anything you change here is written into the ${fileLabel} before it's uploaded.`
          : `The ${fileLabel} is uploaded as it is.`}
      </Text>
    </div>
  );
}
