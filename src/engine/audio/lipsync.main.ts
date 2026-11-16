/**
 * Buzzar: lip sync. Analyses every voice (your microphone and each peer's stream) and sends rough mouth shapes
 * ("visemes") to the game thread, which moves avatars' mouths (see engine/avatar/face.ts).
 *
 * Loudness (relative to each voice's own peak) opens the mouth with every syllable, and the vowel, found from the
 * vocal tract's resonances, picks the shape: open "aa", spread "ih"/"ee", round "ou"/"oh" (see visemes.ts).
 *
 * Each viewer analyses the audio it already receives; nothing extra is networked.
 */
import { MainContext } from "../MainThread";
import { Thread } from "../module/module.common";
import { LipSyncMessage, LipSyncMessageType, LOCAL_VOICE, VISEMES } from "./lipsync.common";
import { VisemeEstimator } from "./visemes";


interface VoiceAnalysis {
  key: string;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  /** The stream or node it was built from, to notice replacements. */
  input: MediaStream | AudioNode;
  ownsSource: boolean;
  time: Float32Array;
  estimator: VisemeEstimator;
  smoothed: Float32Array;
  sentNonZero: boolean;
}

/** ~21 ms at 48 kHz: short enough to follow syllables, long enough for a couple of pitch periods. */
const FFT_SIZE = 1024;
/** Send at most this often (seconds). */
const SEND_INTERVAL = 1 / 30;
const ATTACK = 0.03;
const RELEASE = 0.07;

const voices = new Map<string, VoiceAnalysis>();
let sinceSend = 0;

function createAnalysis(context: AudioContext, key: string, input: MediaStream | AudioNode): VoiceAnalysis {
  const ownsSource = input instanceof MediaStream;
  const source = ownsSource
    ? context.createMediaStreamSource(input as MediaStream)
    : (input as MediaStreamAudioSourceNode);
  const analyser = new AnalyserNode(context, { fftSize: FFT_SIZE, smoothingTimeConstant: 0 });
  source.connect(analyser);
  return {
    key,
    source,
    analyser,
    input,
    ownsSource,
    time: new Float32Array(analyser.fftSize),
    estimator: new VisemeEstimator(),
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
  for (const a of voices.values()) {
    a.analyser.getFloatTimeDomainData(a.time);
    a.estimator.estimate(a.time, context.sampleRate, dt, _raw);
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
