/**
 * Buzzar's Matrix layer (plan 02): browser services the Matrix layer and UI share: saved sessions,
 * settings storage, file picking, blobs and microphone access.
 */
import configData from "../../config.json";

export interface ISessionInfo {
  id: string;
  deviceId: string;
  userId: string;
  homeserver: string;
  /** @deprecated use homeserver */
  homeServer: string;
  accessToken: string;
  lastUsed: number;
  refreshToken?: string;
  /** OIDC: where tokens are refreshed, and with which client. */
  oidcIssuer?: string;
  oidcClientId?: string;
  accountManagementUrl?: string;
}

const SESSIONS_KEY = "buzzar_sessions_v1";
/** Where the SDK Buzzar used before plan 02 kept its sessions. */
const LEGACY_SESSIONS_KEY = "hydrogen_sessions_v1";

export class SessionInfoStorage {
  /**
   * Sessions saved before plan 02. Their devices' encryption keys can't move to the new encryption engine, so
   * they're signed out; returns whether there were any (the user then needs to sign in again).
   */
  async endLegacySessions(): Promise<boolean> {
    let sessions: Partial<ISessionInfo>[] = [];
    try {
      const stored = JSON.parse(localStorage.getItem(LEGACY_SESSIONS_KEY) ?? "[]");
      if (Array.isArray(stored)) sessions = stored;
    } catch {
      // unreadable: just drop it
    }
    localStorage.removeItem(LEGACY_SESSIONS_KEY);
    await Promise.all(
      sessions.map((session) => {
        const homeserver = (session.homeserver ?? session.homeServer ?? "").replace(/\/+$/, "");
        if (!homeserver || !session.accessToken) return undefined;
        return fetch(`${homeserver}/_matrix/client/v3/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}` },
        }).catch(() => undefined);
      })
    );
    return sessions.length > 0;
  }

  async getAll(): Promise<ISessionInfo[]> {
    try {
      const sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? "[]");
      return Array.isArray(sessions) ? sessions : [];
    } catch {
      return [];
    }
  }

  private live?: { id: string; accessToken: () => string | null | undefined };

  /**
   * The running session's token source. Short-lived (OIDC) tokens are refreshed in memory a moment before the
   * saved copy is rewritten, so `get` answers with the live one for that session.
   */
  setLive(id: string, accessToken: () => string | null | undefined) {
    this.live = { id, accessToken };
  }

  clearLive(id: string) {
    if (this.live?.id === id) this.live = undefined;
  }

  async get(id: string): Promise<ISessionInfo | undefined> {
    const info = (await this.getAll()).find((session) => session.id === id);
    const liveToken = info && this.live?.id === id ? this.live.accessToken() : undefined;
    return info && liveToken ? { ...info, accessToken: liveToken } : info;
  }

  async add(info: ISessionInfo) {
    const sessions = (await this.getAll()).filter((session) => session.id !== info.id);
    sessions.unshift(info);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }

  async update(id: string, changes: Partial<ISessionInfo>) {
    const sessions = await this.getAll();
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    Object.assign(session, changes);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }

  async delete(id: string) {
    const sessions = (await this.getAll()).filter((session) => session.id !== id);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }
}

export class SettingsStorage {
  private prefix = "buzzar_setting_v1_";

  async setInt(key: string, value: number) {
    localStorage.setItem(this.prefix + key, String(value));
  }

  async getInt(key: string, defaultValue = 0) {
    const value = localStorage.getItem(this.prefix + key);
    return value === null ? defaultValue : parseInt(value, 10);
  }

  async setString(key: string, value: string) {
    localStorage.setItem(this.prefix + key, value);
  }

  async getString(key: string) {
    return localStorage.getItem(this.prefix + key) ?? undefined;
  }

  async remove(key: string) {
    localStorage.removeItem(this.prefix + key);
  }
}

export interface IBlobHandle {
  nativeBlob: Blob;
  url: string;
  size: number;
  mimeType: string;
  readAsBuffer(): Promise<ArrayBuffer>;
  dispose(): void;
  /** The same blob; older code reads it under this name. */
  _blob: Blob;
}

export class BlobHandle implements IBlobHandle {
  _blob: Blob;
  private _url?: string;

  constructor(blob: Blob) {
    this._blob = blob;
  }

  static fromBuffer(buffer: BlobPart, mimeType?: string) {
    return new BlobHandle(new Blob([buffer], mimeType ? { type: mimeType } : undefined));
  }

  static fromBlob(blob: Blob) {
    return new BlobHandle(blob);
  }

  get nativeBlob() {
    return this._blob;
  }

  get url() {
    if (!this._url) this._url = URL.createObjectURL(this._blob);
    return this._url;
  }

  get size() {
    return this._blob.size;
  }

  get mimeType() {
    return this._blob.type || "application/octet-stream";
  }

  readAsBuffer() {
    return this._blob.arrayBuffer();
  }

  dispose() {
    if (this._url) URL.revokeObjectURL(this._url);
    this._url = undefined;
  }
}

/** A MediaStream with the track accessors the app reads. */
export interface Stream extends MediaStream {
  readonly audioTrack: MediaStreamTrack | undefined;
  readonly videoTrack: MediaStreamTrack | undefined;
}

export function toStream(stream: MediaStream): Stream {
  const s = stream as Stream;
  if (!("audioTrack" in s)) {
    Object.defineProperty(s, "audioTrack", { get: () => stream.getAudioTracks()[0] });
    Object.defineProperty(s, "videoTrack", { get: () => stream.getVideoTracks()[0] });
  }
  return s;
}

/** Says whether a stream is carrying speech right now (for the speaking indicator). */
class VolumeMeasurer {
  private analyser?: AnalyserNode;
  private data?: Uint8Array<ArrayBuffer>;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;

  constructor(stream: MediaStream) {
    try {
      this.context = new AudioContext();
      this.source = this.context.createMediaStreamSource(stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      this.source.connect(this.analyser);
      this.data = new Uint8Array(this.analyser.fftSize);
    } catch (e) {
      console.warn("Couldn't measure a stream's volume", e);
    }
  }

  get isSpeaking(): boolean {
    if (!this.analyser || !this.data) return false;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (const sample of this.data) sum += (sample - 128) * (sample - 128);
    return Math.sqrt(sum / this.data.length) / 128 > 0.02;
  }

  stop() {
    this.source?.disconnect();
    this.context?.close().catch(() => undefined);
  }
}

export class MediaDevices {
  async enumerate() {
    return navigator.mediaDevices.enumerateDevices();
  }

  /** `audio`/`video`: true, false, or constraints (e.g. a chosen microphone). */
  async getMediaTracks(
    audio: true | false | MediaDeviceInfo | MediaTrackConstraints,
    video: boolean | MediaDeviceInfo | MediaTrackConstraints
  ): Promise<Stream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audio as boolean | MediaTrackConstraints,
      video: video as boolean | MediaTrackConstraints,
    });
    return toStream(stream);
  }

  createVolumeMeasurer(stream: MediaStream, _callback?: () => void) {
    return new VolumeMeasurer(stream);
  }
}

export interface ILogItem {
  log(label: unknown): void;
  set(key: string, value: unknown): void;
  wrap<T>(label: unknown, callback: (log: ILogItem) => T): T;
}

const logItem: ILogItem = {
  log: () => undefined,
  set: () => undefined,
  wrap: (_label, callback) => callback(logItem),
};

/** The last console lines (matrix-js-sdk and Buzzar both log there), for bug reports. */
const recentLogs: string[] = [];
const MAX_LOG_LINES = 3000;
let capturing = false;

function captureConsole() {
  if (capturing || typeof console === "undefined") return;
  capturing = true;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        const text = args
          .map((arg) =>
            typeof arg === "string" ? arg : arg instanceof Error ? `${arg.name}: ${arg.message}` : safeJson(arg)
          )
          .join(" ");
        recentLogs.push(`${new Date().toISOString()} ${level.toUpperCase()} ${text.slice(0, 2000)}`);
        if (recentLogs.length > MAX_LOG_LINES) recentLogs.splice(0, recentLogs.length - MAX_LOG_LINES);
      } catch {
        // never let logging break the caller
      }
      original(...args);
    };
  }
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Sends a bug report (description + logs) to a rageshake server. */
export async function submitLogsToRageshakeServer(
  data: { app: string; userAgent: string; version: string; text: string },
  logs: IBlobHandle,
  endpointUrl: string,
  _request?: unknown
): Promise<void> {
  const form = new FormData();
  form.append("text", data.text);
  form.append("app", data.app);
  form.append("user_agent", data.userAgent);
  form.append("version", data.version);
  form.append("file", logs.nativeBlob, "logs.txt");
  const res = await fetch(endpointUrl, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Couldn't send the report (${res.status})`);
}

/** Runs labelled work (there are no structured logs), and exports the console's recent lines for bug reports. */
export class Logger {
  reporters: { export: () => Promise<{ asBlob(): BlobHandle }> }[] = [
    {
      export: async () => ({
        asBlob: () => BlobHandle.fromBuffer(recentLogs.join("\n"), "text/plain"),
      }),
    },
  ];

  constructor() {
    captureConsole();
  }

  run<T>(_label: unknown, callback: (log: ILogItem) => T): T {
    return callback(logItem);
  }

  get item() {
    return logItem;
  }
}

export type ILogger = Logger;

type AppConfig = typeof configData & {
  defaultHomeServer: string;
  homeserverList: string[];
  oidcClientUri?: string;
  staticOidcClients?: Record<string, { client_id: string }>;
};

export class Platform {
  readonly config: AppConfig;
  readonly sessionInfoStorage = new SessionInfoStorage();
  readonly settingsStorage = new SettingsStorage();
  readonly mediaDevices = new MediaDevices();
  readonly logger = new Logger();

  constructor(options: { config: unknown }) {
    this.config = options.config as AppConfig;
  }

  get devicePixelRatio() {
    return window.devicePixelRatio || 1;
  }

  get version() {
    return (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? "dev";
  }

  get description() {
    return navigator.userAgent ?? "<unknown>";
  }

  createBlob(buffer: BlobPart, mimeType?: string): BlobHandle {
    return BlobHandle.fromBuffer(buffer, mimeType);
  }

  openUrl = (url: string) => {
    window.location.assign(url);
  };

  /** Opens the browser's file picker; resolves undefined if nothing was chosen. */
  openFile(mimeType?: string): Promise<{ name: string; blob: BlobHandle } | undefined> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      if (mimeType) input.accept = mimeType;
      input.style.display = "none";
      const done = () => {
        input.remove();
        const file = input.files?.[0];
        resolve(file ? { name: file.name, blob: BlobHandle.fromBlob(file) } : undefined);
      };
      input.addEventListener("change", done, { once: true });
      input.addEventListener("cancel", done, { once: true });
      document.body.append(input);
      input.click();
    });
  }
}
