import { ChangeEvent, FormEvent, useCallback, useEffect, useState, useRef } from "react";
import { useSetAtom } from "jotai";

import { Room, StateEvent } from "../../../../matrix";
import { IconButton } from "../../../atoms/button/IconButton";
import { Content } from "../../../atoms/content/Content";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { Window } from "../../components/window/Window";
import CrossIC from "../../../../../res/ic/cross.svg";
import { WindowContent } from "../../components/window/WindowContent";
import { ScenePreview } from "../../components/scene-preview/ScenePreview";
import { Scroll } from "../../../atoms/scroll/Scroll";
import { Footer } from "../../../atoms/footer/Footer";
import { Button } from "../../../atoms/button/Button";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { ThingRulesDraft, WorldThingRules } from "./WorldThingRules";
import { SettingsNav, SettingsNavItem } from "../user-profile/SettingsNav";
import SettingIC from "../../../../../res/ic/setting.svg";
import PlanetIC from "../../../../../res/ic/planet.svg";
import BoxIC from "../../../../../res/ic/box-3d.svg";
import {
  parseListedThings,
  serializeObjectRules,
  WORLD_RULES_EVENT,
} from "../../../../engine/network/spawnRules.common";
import { Label } from "../../../atoms/text/Label";
import { AvatarPicker } from "../../components/avatar-picker/AvatarPicker";
import { useFilePicker } from "../../../hooks/useFilePicker";
import { useHydrogen } from "../../../hooks/useHydrogen";
import "./WorldSettings.css";
import { getAvatarHttpUrl, getHttpUrl } from "../../../utils/avatar";
import { Input } from "../../../atoms/input/Input";
import { Switch } from "../../../atoms/button/Switch";
import UploadIC from "../../../../../res/ic/upload.svg";
import { Icon } from "../../../atoms/icon/Icon";
import { AutoFileUpload, AutoUploadInfo } from "../../components/AutoFileUpload";
import { useIsMounted } from "../../../hooks/useIsMounted";
import { uploadAttachment } from "../../../utils/matrixUtils";
import { MAX_OBJECT_CAP } from "../../../../engine/config.common";
import { OverlayWindow, overlayWindowAtom } from "../../../state/overlayWindow";
import { usePowerLevels } from "../../../hooks/usePowerLevels";
import { EmptyState } from "../../components/empty-state/EmptyState";
import { useStateEventKeyCallback } from "../../../hooks/useStateEventKeyCallback";

// Buzzar: World Settings is split into categories down the left, like User Settings.
type WorldSettingsCategory = "general" | "scene" | "things";
const CATEGORIES: SettingsNavItem<WorldSettingsCategory>[] = [
  { id: "general", label: "General", icon: SettingIC },
  { id: "scene", label: "Scene & Script", icon: PlanetIC },
  { id: "things", label: "Things", icon: BoxIC },
];

function draftFromRules(content: Record<string, unknown> | undefined): ThingRulesDraft {
  const objects = (content?.objects ?? {}) as Record<string, unknown>;
  return {
    default: objects.default === "block" ? "block" : "allow",
    things: parseListedThings(objects),
    blockedBehaviours: Array.isArray(objects.blocked_behaviours)
      ? objects.blocked_behaviours.filter((b): b is string => typeof b === "string")
      : [],
  };
}

interface WorldSettingsProps {
  room: Room;
}

export function WorldSettings({ room }: WorldSettingsProps) {
  const { session, platform } = useHydrogen(true);

  const setOverlayWindow = useSetAtom(overlayWindowAtom);
  const { getPowerLevel, canSendStateEvent } = usePowerLevels(room);
  const myPowerLevel = getPowerLevel(session.userId);
  const isMounted = useIsMounted();

  let httpAvatarUrl = room?.avatarUrl
    ? getAvatarHttpUrl(room.avatarUrl, 150, platform, session.mediaRepository) ?? undefined
    : undefined;
  const { fileData: avatarData, pickFile: pickAvatar, dropFile: dropAvatar } = useFilePicker(platform, "image/*");
  const isAvatarChanged = (httpAvatarUrl || avatarData.blob) && (avatarData.dropUsed > 0 || avatarData.pickUsed > 0);
  httpAvatarUrl = isAvatarChanged ? avatarData.url : httpAvatarUrl;

  const roomName = room?.name ?? "Empty Name";
  const [newName, setNewName] = useState(roomName);

  const isPrivateRef = useRef(true);
  const [isPrivate, setIsPrivate] = useState(true);

  const [worldInfo, setWorldInfo] = useState<{ sceneUrl?: string; previewUrl?: string; maxObjectCap?: number }>({});

  const [sceneInfo, setSceneInfo] = useState<AutoUploadInfo>({});
  const [previewInfo, setPreviewInfo] = useState<AutoUploadInfo>({});
  const [scriptInfo, setScriptInfo] = useState<AutoUploadInfo>({});
  const [category, setCategory] = useState<WorldSettingsCategory>("general");

  // Buzzar: the world's Thing rules, edited here and sent with Save.
  const rulesContent = useRef<Record<string, unknown>>();
  const [savedRules, setSavedRules] = useState<ThingRulesDraft>(() => draftFromRules(undefined));
  const [thingRules, setThingRules] = useState<ThingRulesDraft>(savedRules);
  const rulesTouched = useRef(false);
  const onRules = useCallback((event: StateEvent | undefined) => {
    rulesContent.current = event?.content as Record<string, unknown> | undefined;
    const draft = draftFromRules(rulesContent.current);
    setSavedRules(draft);
    if (!rulesTouched.current) setThingRules(draft);
  }, []);
  useStateEventKeyCallback(room, WORLD_RULES_EVENT, "", onRules);
  const changeThingRules = (draft: ThingRulesDraft) => {
    rulesTouched.current = true;
    setThingRules(draft);
  };
  const rulesChanged = JSON.stringify(thingRules) !== JSON.stringify(savedRules);
  const canEditRules = canSendStateEvent(WORLD_RULES_EVENT, myPowerLevel);

  useEffect(() => {
    if (room) {
      room.getStateEvent("m.room.join_rules").then((event) => {
        if (!isMounted()) return;
        isPrivateRef.current = event?.event?.content.join_rule !== "public";
        setIsPrivate(event?.event?.content.join_rule !== "public");
      });
      Promise.all([room.getStateEvent("m.world"), room.getStateEvent("org.matrix.msc3815.world")])
        .then(([oldEvent, event]) => {
          if (!isMounted()) return;
          const oldContent = oldEvent?.event?.content;
          const content = event?.event?.content;
          setWorldInfo({
            sceneUrl: content?.scene_url || oldContent?.scene_url,
            previewUrl: content?.scene_preview_url || oldContent?.scene_preview_url,
          });
          const fetchedMaxObjectCap = content?.max_member_object_cap ?? MAX_OBJECT_CAP;
          maxObjectCapRef.current = fetchedMaxObjectCap;
          setMaxObjectCap(fetchedMaxObjectCap);
        })
        .catch(console.error);
    }
  }, [room, isMounted]);

  const handleNameChange = (evt: ChangeEvent<HTMLInputElement>) => setNewName(evt.target.value.trim());

  const maxObjectCapRef = useRef(MAX_OBJECT_CAP);
  const [maxObjectCap, setMaxObjectCap] = useState(MAX_OBJECT_CAP);
  const handleMaxObjectCapChange = (evt: ChangeEvent<HTMLInputElement>) =>
    setMaxObjectCap(parseInt(evt.target.value) || 0);

  const handleSubmit = (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    if (!room) return;
    if (isAvatarChanged) {
      (async () => {
        let mxc = "";
        if (avatarData.blob) {
          mxc = (await uploadAttachment(session.hsApi, avatarData.blob)) ?? "";
        }
        session.hsApi.sendState(room.id, "m.room.avatar", "", {
          url: mxc,
        });
      })();
    }
    if (isPrivateRef.current !== isPrivate) {
      session.hsApi.sendState(room.id, "m.room.join_rules", "", {
        join_rule: isPrivate ? "invite" : "public",
      });
    }
    if (roomName !== newName && newName.trim() !== "") {
      session.hsApi.sendState(room.id, "m.room.name", "", {
        name: newName,
      });
    }

    if (sceneInfo.mxc || previewInfo.mxc || maxObjectCap !== maxObjectCapRef.current || scriptInfo.mxc) {
      Promise.all([room.getStateEvent("m.world"), room.getStateEvent("org.matrix.msc3815.world")]).then(
        ([oldEvent, event]) => {
          const oldContent = oldEvent?.event?.content;
          const content = event?.event?.content;
          const existingScriptUrl = event?.event.content.script_url;
          session.hsApi.sendState(room.id, "org.matrix.msc3815.world", "", {
            max_member_object_cap: maxObjectCap,
            scene_url: sceneInfo.mxc ?? (content?.scene_url || oldContent?.scene_url),
            scene_preview_url: previewInfo.mxc ?? (content?.scene_preview_url || oldContent?.scene_preview_url),
            script_url: scriptInfo.mxc || existingScriptUrl,
          });
        }
      );
    }

    const capChanged = maxObjectCap !== maxObjectCapRef.current;
    if (canEditRules && (rulesChanged || capChanged)) {
      const content = rulesContent.current ?? {};
      const previous = (content.objects ?? {}) as Record<string, unknown>;
      const objects = serializeObjectRules(previous, thingRules);
      // A per-person limit in the rules overrides the world's; keep the two the same.
      if (capChanged && objects.max_per_user !== undefined) objects.max_per_user = maxObjectCap;
      session.hsApi.sendState(room.id, WORLD_RULES_EVENT, "", { ...content, objects });
    }

    setOverlayWindow({ type: OverlayWindow.None });
  };

  const canEditScene = canSendStateEvent("org.matrix.msc3815.world", myPowerLevel);
  const scenePreviewSrc = previewInfo.url ?? getHttpUrl(session, worldInfo.previewUrl);

  return (
    <Window onRequestClose={() => setOverlayWindow({ type: OverlayWindow.None })}>
      <Content
        onSubmit={handleSubmit}
        top={
          <Header
            left={<HeaderTitle>World Settings</HeaderTitle>}
            right={
              <IconButton
                onClick={() => setOverlayWindow({ type: OverlayWindow.None })}
                label="Close"
                iconSrc={CrossIC}
              />
            }
          />
        }
      >
        <WindowContent
          children={
            <Content
              children={
                <div className="WorldSettings flex grow">
                  <SettingsNav items={CATEGORIES} selected={category} onSelect={setCategory} />
                  <Scroll className="grow">
                    <div className="WorldSettings__content">
                      <Text variant="s1" weight="semi-bold">
                        {CATEGORIES.find((item) => item.id === category)?.label}
                      </Text>
                      {/* Every category stays mounted (hidden) so unsaved edits survive switching. */}
                      <div className="WorldSettings__section" hidden={category !== "general"}>
                        {canSendStateEvent("m.room.avatar", myPowerLevel) && (
                          <SettingTile label={<Label>World Avatar</Label>}>
                            <AvatarPicker url={httpAvatarUrl} onAvatarPick={pickAvatar} onAvatarDrop={dropAvatar} />
                          </SettingTile>
                        )}
                        {canSendStateEvent("m.room.name", myPowerLevel) && (
                          <SettingTile label={<Label>World Name *</Label>}>
                            <Input onChange={handleNameChange} defaultValue={roomName} required />
                          </SettingTile>
                        )}
                        {canSendStateEvent("m.room.join_rules", myPowerLevel) && (
                          <SettingTile label={<Label>Private</Label>}>
                            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
                          </SettingTile>
                        )}
                        <EmptyState
                          className="WorldSettings__empty-state"
                          heading="Permission Required"
                          text="You don't have permission to change these settings."
                        />
                      </div>
                      <div className="WorldSettings__section" hidden={category !== "scene"}>
                        {canEditScene && (
                          <>
                            <SettingTile label={<Label>Scene</Label>}>
                              <AutoFileUpload
                                mimeType=".glb"
                                onUploadInfo={setSceneInfo}
                                renderButton={(pickFile) => (
                                  <Button fill="outline" onClick={pickFile}>
                                    <Icon src={UploadIC} color="primary" />
                                    Change Scene
                                  </Button>
                                )}
                              />
                            </SettingTile>
                            <SettingTile label={<Label>Scene Preview</Label>}>
                              <ScenePreview
                                className="WorldSettings__preview"
                                src={scenePreviewSrc}
                                alt="Scene Preview"
                                fallback={
                                  <Text variant="b3" color="surface-low" weight="medium">
                                    Your uploaded scene preview will appear here.
                                  </Text>
                                }
                              />
                              <AutoFileUpload
                                mimeType="image/*"
                                onUploadInfo={setPreviewInfo}
                                renderButton={(pickFile) => (
                                  <Button fill="outline" onClick={pickFile}>
                                    <Icon src={UploadIC} color="primary" />
                                    Change Preview
                                  </Button>
                                )}
                              />
                            </SettingTile>
                            <SettingTile label={<Label>Script (EXPERIMENTAL)</Label>}>
                              <AutoFileUpload
                                mimeType=".js,.wasm"
                                onUploadInfo={setScriptInfo}
                                renderButton={(pickFile) => (
                                  <Button fill="outline" onClick={pickFile}>
                                    <Icon src={UploadIC} color="primary" />
                                    Change Script
                                  </Button>
                                )}
                              />
                            </SettingTile>
                          </>
                        )}
                        <EmptyState
                          className="WorldSettings__empty-state"
                          heading="Permission Required"
                          text="You don't have permission to change the scene or script."
                        />
                      </div>
                      <div className="WorldSettings__section" hidden={category !== "things"}>
                        {canEditScene && (
                          <SettingTile label={<Label>Max Spawned Things Per Person</Label>}>
                            <Input type="number" value={maxObjectCap} onChange={handleMaxObjectCapChange} required />
                          </SettingTile>
                        )}
                        <WorldThingRules value={thingRules} onChange={changeThingRules} disabled={!canEditRules} />
                        {!canEditRules && (
                          <Text variant="b3" color="surface-low">
                            You don't have permission to change these rules.
                          </Text>
                        )}
                      </div>
                    </div>
                  </Scroll>
                </div>
              }
              bottom={
                <Footer
                  left={
                    <Button size="lg" fill="outline" onClick={() => setOverlayWindow({ type: OverlayWindow.None })}>
                      Cancel
                    </Button>
                  }
                  right={
                    <Button
                      size="lg"
                      type="submit"
                      disabled={
                        !isAvatarChanged &&
                        isPrivateRef.current === isPrivate &&
                        roomName === newName &&
                        !sceneInfo.mxc &&
                        !previewInfo.mxc &&
                        maxObjectCap === maxObjectCapRef.current &&
                        !scriptInfo.mxc &&
                        !rulesChanged
                      }
                    >
                      Save
                    </Button>
                  }
                />
              }
            />
          }
        />
      </Content>
    </Window>
  );
}
