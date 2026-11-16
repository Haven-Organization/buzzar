/**
 * Buzzar: lip sync. Analyses every voice (your microphone and each peer's stream) and sends rough mouth shapes
 * ("visemes") to the game thread, which moves avatars' mouths (see engine/avatar/face.ts).
 *
 * The analysis is deliberately simple and cheap: loudness opens the mouth, and the balance between a few
 * frequency bands (vowel formants) picks the shape: open "aa", wide "ih"/"ee", round "ou"/"oh". It isn't
 * phoneme-accurate, but mouths move in time with speech and change shape with it, which is what reads as talking.
 *
 * Each viewer analyses the audio it already receives; nothing extra is networked.
 */
import { MainContext } from "../MainThread";
import { Thread } from "../module/module.common";
import { LipSyncMessage, LipSyncMessageType, LOCAL_VOICE, VISEMES } from "./lipsync.common";


interface VoiceAnalysis {
  key: string;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  /** The stream or node it was built from, to notice replacements. */
  input: MediaStream | AudioNode;
  ownsSource: boolean;
  freq: Float32Array;
  time: Float32Array;
  smoothed: Float32Array;
  sentNonZero: boolean;
}

const FFT_SIZE = 1024;
/** Send at most this often (seconds). */
const SEND_INTERVAL = 1 / 30;
/** Below this level (dBFS) counts as silence; at QUIET + RANGE the mouth is fully open. */
const QUIET_DB = -52;
const RANGE_DB = 30;
const ATTACK = 0.035;
const RELEASE = 0.09;

const voices = new Map<string, VoiceAnalysis>();
let sinceSend = 0;

function createAnalysis(context: AudioContext, key: string, input: MediaStream | AudioNode): VoiceAnalysis {
  const ownsSource = input instanceof MediaStream;
  const source = ownsSource
    ? context.createMediaStreamSource(input as MediaStream)
    : (input as MediaStreamAudioSourceNode);
  const analyser = new AnalyserNode(context, { fftSize: FFT_SIZE, smoothingTimeConstant: 0.3 });
  source.connect(analyser);
  return {
    key,
    source,
    analyser,
    input,
    ownsSource,
    freq: new Float32Array(analyser.frequencyBinCount),
    time: new Float32Array(analyser.fftSize),
    smoothed: new Float32Array(VISEMES.length),
    sentNonZero: false,
  };
}

function disposeAnalysis(a: VoiceAnalysis) {
  try {
    a.source.disconnect(a.analyser);
  } catch {
    // already disconnected
  }
}

/** Band power (linear) between two frequencies. */
function bandPower(freq: Float32Array, binHz: number, from: number, to: number): number {
  let sum = 0;
  const end = Math.min(freq.length - 1, Math.floor(to / binHz));
  for (let i = Math.max(1, Math.floor(from / binHz)); i <= end; i++) sum += 10 ** (freq[i] / 10);
  return sum;
}

/**
 * Viseme weights for one block of audio. Exported for tests: `time` is the waveform (-1..1), `freq` the spectrum
 * in dB, `binHz` the width of one spectrum bin.
 */
export function estimateVisemes(time: Float32Array, freq: Float32Array, binHz: number, out: Float32Array) {
  let sq = 0;
  for (let i = 0; i < time.length; i++) sq += time[i] * time[i];
  const db = 10 * Math.log10(sq / time.length + 1e-12);
  const open = Math.min(1, Math.max(0, (db - QUIET_DB) / RANGE_DB));
  if (open <= 0) {
    out.fill(0);
    return out;
  }

  // Vowel formants: F1 (low = closed/round, high = open), F2 (high = front/spread "i"/"e").
  const low = bandPower(freq, binHz, 200, 500);
  const mid = bandPower(freq, binHz, 500, 1100);
  const high = bandPower(freq, binHz, 1500, 3200);
  const total = low + mid + high + 1e-12;
  const l = low / total;
  const m = mid / total;
  const h = high / total;

  out[0] = m * (1 - h); // aa: open, energy around 500–1100 Hz
  out[1] = h * (1 - l); // ih: bright, little low energy
  out[2] = l * (1 - m) * (1 - h); // ou: dark and closed
  out[3] = h * l; // ee: low F1 + high F2
  out[4] = l * m; // oh: low + mid, rounded
  let sum = 0;
  for (let i = 0; i < out.length; i++) sum += out[i];
  for (let i = 0; i < out.length; i++) out[i] = sum > 0 ? (out[i] / sum) * open : 0;
  return out;
}

const _raw = new Float32Array(VISEMES.length);

/** Called every main-thread frame from the audio system. */
export function updateLipSync(
  ctx: MainContext,
  context: AudioContext,
  peerStreams: Map<string, MediaStream>,
  localSource: MediaStreamAudioSourceNode | undefined
) {
  // Keep one analysis per voice, rebuilt when its stream changes.
  const wanted = new Map<string, MediaStream | AudioNode>(peerStreams);
  if (localSource) wanted.set(LOCAL_VOICE, localSource);
  for (const [key, a] of voices) {
    if (wanted.get(key) !== a.input) {
      disposeAnalysis(a);
      voices.delete(key);
      // Make sure the mouth closes if the voice went away mid-word.
      if (a.sentNonZero) pendingZero.add(key);
    }
  }
  for (const [key, input] of wanted) {
    if (!voices.has(key)) {
      try {
        voices.set(key, createAnalysis(context, key, input));
      } catch (error) {
        console.warn("Lip sync: can't analyse voice", key, error);
      }
    }
  }

  const dt = ctx.dt > 0 ? ctx.dt : 1 / 60;
  const binHz = context.sampleRate / FFT_SIZE;
  for (const a of voices.values()) {
    a.analyser.getFloatTimeDomainData(a.time);
    a.analyser.getFloatFrequencyData(a.freq);
    estimateVisemes(a.time, a.freq, binHz, _raw);
    for (let i = 0; i < _raw.length; i++) {
      const rate = _raw[i] > a.smoothed[i] ? ATTACK : RELEASE;
      a.smoothed[i] += (_raw[i] - a.smoothed[i]) * (1 - Math.exp(-dt / rate));
      if (a.smoothed[i] < 0.002) a.smoothed[i] = 0;
    }
  }

  sinceSend += dt;
  if (sinceSend < SEND_INTERVAL) return;
  sinceSend = 0;

  const out: LipSyncMessage["voices"] = [];
  for (const key of pendingZero) out.push([key, [0, 0, 0, 0, 0]]);
  pendingZero.clear();
  for (const a of voices.values()) {
    const nonZero = a.smoothed.some((v) => v > 0);
    if (!nonZero && !a.sentNonZero) continue;
    out.push([a.key, Array.from(a.smoothed, (v) => Math.round(v * 1000) / 1000)]);
    a.sentNonZero = nonZero;
  }
  if (out.length > 0) ctx.sendMessage<LipSyncMessage>(Thread.Game, { type: LipSyncMessageType, voices: out });
}

const pendingZero = new Set<string>();

export function disposeLipSync() {
  for (const a of voices.values()) disposeAnalysis(a);
  voices.clear();
  pendingZero.clear();
}
