import { useState, ChangeEvent, FormEvent, useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";

import { Content } from "../../../atoms/content/Content";
import { WindowContent } from "../../components/window/WindowContent";
import { useMatrix } from "../../../hooks/useMatrix";
import { Scroll } from "../../../atoms/scroll/Scroll";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { Switch } from "../../../atoms/button/Switch";
import { Input } from "../../../atoms/input/Input";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { getAvatarHttpUrl } from "../../../utils/avatar";
import { Footer } from "../../../atoms/footer/Footer";
import { Button } from "../../../atoms/button/Button";
import { useDebounce } from "../../../hooks/useDebounce";
import "./UserProfileOverview.css";
import { MicrophoneSettings } from "./MicrophoneSettings";
import { HomeWorldSettings } from "./HomeWorldSettings";
import { BuzzarSpaceSetting } from "./BuzzarSpaceSetting";
import { WorldScriptSettings } from "./WorldScriptSettings";
import { ProfileExtrasSettings } from "./ProfileExtrasSettings";
import { AvatarPicker } from "../../components/avatar-picker/AvatarPicker";
import { useFilePicker } from "../../../hooks/useFilePicker";
import { uploadAttachment } from "../../../utils/matrixUtils";
import { useLocalStorage } from "../../../hooks/useLocalStorage";
import { SelectInput } from "../../components/property-panel/SelectInput";
import {
  LOCAL_STORAGE_RENDER_QUALITY,
  LOCAL_STORAGE_WORLD_REVEAL,
  LOCAL_STORAGE_SHADOW_QUALITY,
  ShadowQualitySetting,
  RenderQualityOptions,
  RenderQualitySetting,
  RenderQualityToSetting,
} from "../../../../engine/renderer/renderer.common";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { OverlayWindow, overlayWindowAtom } from "../../../state/overlayWindow";
import { userProfileAtom } from "../../../state/userProfile";
import { ControlsSettings } from "./ControlsSettings";
import { DeveloperSettings } from "./DeveloperSettings";
import { SettingsNav, SettingsNavItem } from "./SettingsNav";
import AvatarIC from "../../../../../res/ic/avatar.svg";
import MicIC from "../../../../../res/ic/mic.svg";
import DarkLightIC from "../../../../../res/ic/dark-light.svg";
import MouseIC from "../../../../../res/ic/mouse.svg";
import PlanetIC from "../../../../../res/ic/planet.svg";
import CurlyBracketIC from "../../../../../res/ic/curly-bracket.svg";

// Buzzar: settings are split into categories, picked from a list down the left (like Element).
type SettingsCategory = "profile" | "voice" | "graphics" | "controls" | "worlds" | "developer";
const CATEGORIES: SettingsNavItem<SettingsCategory>[] = [
  { id: "profile", label: "Profile", icon: AvatarIC },
  { id: "voice", label: "Voice", icon: MicIC },
  { id: "graphics", label: "Graphics", icon: DarkLightIC },
  { id: "controls", label: "Controls", icon: MouseIC },
  { id: "worlds", label: "Worlds & Scripts", icon: PlanetIC },
  { id: "developer", label: "Developer", icon: CurlyBracketIC },
];

export function UserProfileOverview() {
  const { session, platform } = useMatrix(true);
  const { displayName, avatarUrl } = useAtomValue(userProfileAtom);
  const setOverlayWindow = useSetAtom(overlayWindowAtom);

  const [newDisplayName, setNewDisplayName] = useState(displayName);
  const [renderQuality, setRenderQuality] = useLocalStorage(LOCAL_STORAGE_RENDER_QUALITY, RenderQualitySetting.Auto);
  const [worldReveal, setWorldReveal] = useLocalStorage(LOCAL_STORAGE_WORLD_REVEAL, true);
  const [shadowQuality, setShadowQuality] = useLocalStorage(LOCAL_STORAGE_SHADOW_QUALITY, ShadowQualitySetting.Auto);
  const shadowQualityOptions = useMemo(
    () => [
      { value: ShadowQualitySetting.Auto, label: "Auto (from Graphics Quality)" },
      { value: ShadowQualitySetting.Off, label: "Off (fastest)" },
      { value: ShadowQualitySetting.Low, label: "Low" },
      { value: ShadowQualitySetting.Medium, label: "Medium" },
      { value: ShadowQualitySetting.High, label: "High" },
    ],
    []
  );
  const [category, setCategory] = useState<SettingsCategory>("profile");

  const mainThread = useMainThreadContext();

  const renderQualityOptions = useMemo(() => {
    const currentQuality = RenderQualityOptions.find(
      (option) => option.value === RenderQualityToSetting[mainThread.quality]
    );
    return [{ value: RenderQualitySetting.Auto, label: `Auto (${currentQuality?.label})` }, ...RenderQualityOptions];
  }, [mainThread.quality]);

  let httpAvatarUrl = avatarUrl
    ? getAvatarHttpUrl(avatarUrl, 150, platform, session.mediaRepository) ?? undefined
    : undefined;

  const {
    fileData: avatarData,
    pickFile: pickAvatar,
    dropFile: dropAvatar,
    resetUses: resetAvatarUses,
  } = useFilePicker(platform, "image/*");
  const isAvatarChanged = avatarData.dropUsed > 0 || avatarData.pickUsed > 0;
  httpAvatarUrl = isAvatarChanged ? avatarData.url : httpAvatarUrl;

  const debounceDisplayNameChange = useDebounce(setNewDisplayName, { wait: 200 });
  const onDisplayNameChange = (evt: ChangeEvent<HTMLInputElement>) => {
    const name = evt.currentTarget.value.trim();
    debounceDisplayNameChange(name);
  };

  const handleSubmit = async (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    setOverlayWindow({ type: OverlayWindow.None });
    const name = evt.currentTarget.displayName.value.trim() as string;
    if (name !== displayName && name !== "") {
      session.hsApi.setProfileDisplayName(session.userId, name);
    }
    if (isAvatarChanged) {
      let mxc = "";
      if (typeof avatarData.blob === "object") {
        mxc = (await uploadAttachment(session.hsApi, avatarData.blob)) ?? "";
      }
      session.hsApi.setProfileAvatarUrl(session.userId, mxc);
    }
  };
  const handleReset = () => {
    setNewDisplayName(displayName);
    resetAvatarUses();
    setOverlayWindow({ type: OverlayWindow.None });
  };

  return (
    <WindowContent
      children={
        <Content
          onSubmit={handleSubmit}
          onReset={handleReset}
          children={
            <div className="UserProfileOverview flex grow">
              <SettingsNav items={CATEGORIES} selected={category} onSelect={setCategory} />
              <Scroll className="grow">
                <div className="UserProfileOverview__content">
                  <Text variant="s1" weight="semi-bold">
                    {CATEGORIES.find((item) => item.id === category)?.label}
                  </Text>
                  {/* The profile fields stay mounted (hidden) so unsaved edits survive switching categories. */}
                  <div className="UserProfileOverview__section" hidden={category !== "profile"}>
                    <SettingTile label={<Label>Profile Picture</Label>}>
                      <AvatarPicker url={httpAvatarUrl} onAvatarPick={pickAvatar} onAvatarDrop={dropAvatar} />
                    </SettingTile>
                    <SettingTile label={<Label>Default Display Name</Label>}>
                      <Input
                        name="displayName"
                        onChange={onDisplayNameChange}
                        defaultValue={displayName}
                        required
                        aria-label="Default display name"
                      />
                    </SettingTile>
                    <ProfileExtrasSettings />
                  </div>
                  {category === "voice" && (
                    <div className="UserProfileOverview__section">
                      <MicrophoneSettings />
                    </div>
                  )}
                  {category === "graphics" && (
                    <div className="UserProfileOverview__section">
                      <SettingTile label={<Label>Graphics Quality (Requires Refresh)</Label>}>
                        <SelectInput options={renderQualityOptions} value={renderQuality} onChange={setRenderQuality} />
                      </SettingTile>
                      <SettingTile label={<Label>Shadows (Requires Refresh)</Label>}>
                        <SelectInput options={shadowQualityOptions} value={shadowQuality} onChange={setShadowQuality} />
                      </SettingTile>
                      <SettingTile
                        label={<Label>World Reveal Effect (Requires Refresh)</Label>}
                        // Third Room #267: a world appears in green Matrix code for a moment, then fully shaded.
                      >
                        <Switch checked={worldReveal} onCheckedChange={setWorldReveal} />
                      </SettingTile>
                    </div>
                  )}
                  {category === "controls" && <ControlsSettings />}
                  {category === "worlds" && (
                    <div className="UserProfileOverview__section">
                      <HomeWorldSettings />
                      <BuzzarSpaceSetting />
                      <WorldScriptSettings />
                    </div>
                  )}
                  {category === "developer" && <DeveloperSettings />}
                </div>
              </Scroll>
            </div>
          }
          bottom={
            (displayName !== newDisplayName || isAvatarChanged) && (
              <Footer
                left={
                  <Button fill="outline" type="reset">
                    Cancel
                  </Button>
                }
                right={<Button type="submit">Save</Button>}
              />
            )
          }
        />
      }
    />
  );
}
