import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../../../atoms/button/Button";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { SelectInput } from "../../components/property-panel/SelectInput";
import { useMicLevel, useSpeaking } from "../../../hooks/useMicLevel";
import { getPreferredMicrophone, listMicrophones, setPreferredMicrophone } from "../../../utils/microphone";
import "./MicrophoneSettings.css";

const DEFAULT = "";
const RECORD_MS = 3000;

/** Buzzar: pick which microphone to use, and test it (live level meter plus record-and-play-back). */
export function MicrophoneSettings() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState(getPreferredMicrophone() ?? DEFAULT);
  const [testStream, setTestStream] = useState<MediaStream>();
  const [status, setStatus] = useState<string>();
  const [recording, setRecording] = useState(false);
  const playback = useRef<HTMLAudioElement | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await listMicrophones());
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  const stopTest = useCallback(() => {
    setTestStream((stream) => {
      stream?.getTracks().forEach((t) => t.stop());
      return undefined;
    });
  }, []);
  useEffect(() => stopTest, [stopTest]);

  const startTest = async (deviceId = selected) => {
    stopTest();
    setStatus(undefined);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      setTestStream(stream);
      // Device names are only visible once the browser has given microphone access.
      refreshDevices();
    } catch (e) {
      const name = (e as Error)?.name;
      setStatus(
        name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser's site settings."
          : name === "NotFoundError" || name === "OverconstrainedError"
          ? "That microphone isn't available. Pick another one."
          : `Couldn't open the microphone: ${(e as Error)?.message ?? e}`
      );
    }
  };

  const choose = async (deviceId: string) => {
    setSelected(deviceId);
    try {
      await setPreferredMicrophone(deviceId || undefined);
    } catch (e) {
      setStatus(`Saved, but couldn't switch the world call: ${(e as Error)?.message ?? e}`);
    }
    if (testStream) startTest(deviceId);
  };

  const recordAndPlay = () => {
    if (!testStream || recording) return;
    const recorder = new MediaRecorder(testStream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      setRecording(false);
      const url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
      const audio = playback.current ?? new Audio();
      playback.current = audio;
      audio.src = url;
      audio.onended = () => URL.revokeObjectURL(url);
      audio.play().catch(() => setStatus("Couldn't play the recording back."));
    };
    setRecording(true);
    recorder.start();
    window.setTimeout(() => recorder.state === "recording" && recorder.stop(), RECORD_MS);
  };

  const level = useMicLevel(testStream);
  const speaking = useSpeaking(level);
  const hasLabels = devices.some((d) => d.label);
  const options = [
    { value: DEFAULT, label: "System default" },
    ...devices.map((d, i) => ({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
  ];
  // A saved device that's unplugged still shows, so the choice isn't silently lost.
  if (selected && !devices.some((d) => d.deviceId === selected)) {
    options.push({ value: selected, label: "Saved microphone (not connected)" });
  }

  return (
    <SettingTile className="grow basis-0" label={<Label>Microphone</Label>}>
      <div className="MicrophoneSettings flex flex-column gap-xs">
        <SelectInput options={options} value={selected} onChange={choose} />
        <div className="flex items-center gap-xs">
          {testStream ? (
            <>
              <Button size="sm" fill="outline" onClick={stopTest}>
                Stop Test
              </Button>
              <Button size="sm" fill="outline" disabled={recording} onClick={recordAndPlay}>
                {recording ? "Recording…" : "Record 3 s and Play Back"}
              </Button>
            </>
          ) : (
            <Button size="sm" fill="outline" onClick={() => startTest()}>
              Test Microphone
            </Button>
          )}
        </div>
        {testStream && (
          <div className="flex items-center gap-xs">
            <div className="MicrophoneSettings__meter grow" aria-label="Microphone level">
              <div
                className="MicrophoneSettings__meter-fill"
                style={{ width: `${Math.min(100, Math.round(level * 400))}%` }}
              />
            </div>
            <Text variant="b3" color={speaking ? "primary" : "surface-low"}>
              {speaking ? "Hearing you" : "Say something…"}
            </Text>
          </div>
        )}
        <Text variant="b3" color="surface-low">
          {status ??
            (hasLabels
              ? "Changes apply right away, including in the world you're in. Saved for this browser."
              : "Test your microphone once to see device names.")}
        </Text>
      </div>
    </SettingTile>
  );
}
