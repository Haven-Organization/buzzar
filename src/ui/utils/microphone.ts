/**
 * Buzzar: the user's chosen microphone (per browser/device, since device IDs are local), and a hook into the
 * world call so a new choice takes effect right away.
 */
const STORAGE_KEY = "buzzar.microphoneDeviceId";

export function getPreferredMicrophone(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

/** The `audio` argument for Hydrogen's `getMediaTracks`: the chosen device, or `true` for the system default. */
export function microphoneConstraint(): true | { deviceId: string } {
  const deviceId = getPreferredMicrophone();
  return deviceId ? { deviceId } : true;
}

type Switcher = (constraint: true | { deviceId: string }) => Promise<void>;
let activeSwitcher: Switcher | undefined;

/** Registered by the world call while you're in a world. */
export function registerMicrophoneSwitcher(switcher: Switcher | undefined) {
  activeSwitcher = switcher;
}

/** Saves the choice (undefined = system default) and switches the world call to it if you're in one. */
export async function setPreferredMicrophone(deviceId: string | undefined) {
  try {
    if (deviceId) localStorage.setItem(STORAGE_KEY, deviceId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable: the choice applies to this session only
  }
  await activeSwitcher?.(deviceId ? { deviceId } : true);
}

export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications");
}
