/**
 * Buzzar: mouth shapes ("visemes") from a voice, for lip sync.
 *
 * Vowels are told apart by the vocal tract's resonances (formants), not by raw band energy: every voice puts
 * most of its energy low (the pitch and its harmonics), whatever the vowel. So each block of audio is analysed
 * with linear prediction (LPC), which models the vocal tract and ignores the pitch; the first two resonances
 * (F1, F2) are read off its spectral envelope and matched to the five vowels:
 *
 *   ih ("ee" as in see)   F1 ≈ 320  F2 ≈ 2550     ee ("e" as in bed)    F1 ≈ 620  F2 ≈ 2050
 *   aa ("a" as in father) F1 ≈ 750  F2 ≈ 1250     oh ("o" as in more)   F1 ≈ 450  F2 ≈ 850
 *   ou ("oo" as in boot)  F1 ≈ 340  F2 ≈ 950, or the "fronted" oo of much English speech: F1 ≈ 400  F2 ≈ 1600
 *
 * Loudness, relative to the voice's own recent peak, decides how open the mouth is, so it opens and closes with
 * every syllable whatever the microphone gain. The values are vowel × loudness: how far each shape opens is up to
 * the face (see mouthOpenness in face.ts), so a quiet "oo" is still clearly an "oo".
 */

/** Viseme order: aa, ih, ou, ee, oh (VRM 1.0 preset names). */
const VISEME_COUNT = 5;
/** [F1, F2, viseme] reference points; a viseme can have several (accents, fronted vowels). */
const PROTOTYPES: [number, number, number][] = [
  [750, 1250, 0], // aa  father, hot
  [320, 2550, 1], // ih  see, cheese
  [340, 950, 2], // ou  boot (back)
  [400, 1600, 2], // ou  boot, food (fronted, common in English)
  [620, 2050, 3], // ee  bed
  [450, 850, 4], // oh  more, go
];

const ORDER = 14;
const DECIMATE = 4;

/** Below the voice's peak by more than this (dB) the mouth is closed. */
const DYNAMIC_RANGE_DB = 26;
/** Absolute silence floor (dBFS). */
const SILENCE_DB = -58;
/** The tracked peak falls by this much per second, so the scale adapts when someone speaks more quietly. */
const PEAK_DECAY_DB_PER_S = 3;
/** Sharpness of the vowel choice: higher commits to one shape instead of a blend. */
const VOWEL_SHARPNESS = 16;

/**
 * Formants from a block of samples (any rate). Returns [F1, F2] in Hz, or undefined if the block is too quiet or
 * no clear resonances were found. Exported for tests.
 */
export function estimateFormants(samples: Float32Array, sampleRate: number): [number, number] | undefined {
  // Decimate (crude low-pass by averaging) to put the formant range in a small LPC model.
  const n = Math.floor(samples.length / DECIMATE);
  const rate = sampleRate / DECIMATE;
  const x = _x.length >= n ? _x : (_x = new Float64Array(n));
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < DECIMATE; k++) s += samples[i * DECIMATE + k];
    x[i] = s / DECIMATE;
  }
  // Pre-emphasis (flattens the voice's natural spectral tilt) and a Hamming window.
  for (let i = n - 1; i > 0; i--) x[i] -= 0.94 * x[i - 1];
  for (let i = 0; i < n; i++) x[i] *= 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));

  // Autocorrelation + Levinson–Durbin.
  const r = _r;
  for (let lag = 0; lag <= ORDER; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
    r[lag] = s;
  }
  if (r[0] <= 1e-10) return undefined;
  r[0] *= 1 + 1e-6; // a touch of white noise for stability
  const a = _a.fill(0);
  a[0] = 1;
  let err = r[0];
  for (let i = 1; i <= ORDER; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    _tmp.set(a);
    for (let j = 1; j < i; j++) a[j] = _tmp[j] + k * _tmp[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 0) return undefined;
  }

  // Formants are the roots of A(z) (resonances), which stay separate even when two of them merge into one hump
  // of the spectral envelope (F1 and F2 of "oo"/"oh" are only ~600 Hz apart).
  const formants = lpcRoots(a, rate)
    .filter((r) => r.freq >= 180 && r.freq <= 3400 && r.bandwidth < 500)
    .map((r) => r.freq)
    .sort((x, y) => x - y);
  const f1 = formants.find((f) => f >= 200 && f <= 1000);
  if (f1 === undefined) return undefined;
  const f2 = formants.find((f) => f > f1 + 150 && f >= 600 && f <= 3200);
  if (f2 === undefined) return undefined;
  return [f1, f2];
}

/**
 * Roots of z^p + a1 z^(p-1) + … + ap (Durand–Kerner) in the upper half-plane, as frequency and bandwidth (Hz).
 */
function lpcRoots(a: Float64Array, rate: number): { freq: number; bandwidth: number }[] {
  const p = ORDER;
  const re = _re;
  const im = _im;
  // Spread the starting points around a circle inside the unit circle.
  for (let k = 0; k < p; k++) {
    const ang = (2 * Math.PI * (k + 0.25)) / p + 0.4;
    re[k] = 0.9 * Math.cos(ang);
    im[k] = 0.9 * Math.sin(ang);
  }
  for (let iter = 0; iter < 80; iter++) {
    let moved = 0;
    for (let k = 0; k < p; k++) {
      // f(z) by Horner
      let fr = 1;
      let fi = 0;
      for (let j = 1; j <= p; j++) {
        const nr = fr * re[k] - fi * im[k] + a[j];
        fi = fr * im[k] + fi * re[k];
        fr = nr;
      }
      // product of (z_k - z_j)
      let dr = 1;
      let di = 0;
      for (let j = 0; j < p; j++) {
        if (j === k) continue;
        const xr = re[k] - re[j];
        const xi = im[k] - im[j];
        const nr = dr * xr - di * xi;
        di = dr * xi + di * xr;
        dr = nr;
      }
      const den = dr * dr + di * di;
      if (den === 0) continue;
      const qr = (fr * dr + fi * di) / den;
      const qi = (fi * dr - fr * di) / den;
      re[k] -= qr;
      im[k] -= qi;
      moved = Math.max(moved, Math.abs(qr) + Math.abs(qi));
    }
    if (moved < 1e-9) break;
  }
  const out: { freq: number; bandwidth: number }[] = [];
  for (let k = 0; k < p; k++) {
    if (im[k] <= 1e-6) continue;
    const mag = Math.hypot(re[k], im[k]);
    if (!(mag > 0 && mag < 1.05)) continue;
    out.push({
      freq: (Math.atan2(im[k], re[k]) * rate) / (2 * Math.PI),
      bandwidth: (-Math.log(mag) * rate) / Math.PI,
    });
  }
  return out;
}

let _x = new Float64Array(256);
const _r = new Float64Array(ORDER + 1);
const _a = new Float64Array(ORDER + 1);
const _tmp = new Float64Array(ORDER + 1);
const _re = new Float64Array(ORDER);
const _im = new Float64Array(ORDER);

/** Soft vowel weights (summing to 1) for a formant pair, in aa/ih/ou/ee/oh order. Exported for tests. */
export function vowelWeights(f1: number, f2: number, out: Float32Array): Float32Array {
  out.fill(0);
  for (const [p1, p2, v] of PROTOTYPES) {
    // Distance in log-frequency (perceptual, and tolerant of higher formants in women's and children's voices).
    const d1 = Math.log(f1 / p1);
    const d2 = Math.log(f2 / p2) * 0.8;
    out[v] = Math.max(out[v], Math.exp(-VOWEL_SHARPNESS * (d1 * d1 + d2 * d2)));
  }
  let sum = 0;
  for (let i = 0; i < VISEME_COUNT; i++) sum += out[i];
  for (let i = 0; i < out.length; i++) out[i] = sum > 0 ? out[i] / sum : 0;
  return out;
}

/**
 * Smoothing. The vowel (which shape) follows quickly, so short vowels in fast speech or singing ("oo-ee-oo-ah-ah")
 * still get their own shape; loudness (how open) is a little smoother so the mouth doesn't flutter.
 */
const VOWEL_TIME = 0.012;
const LOUD_ATTACK = 0.02;
const LOUD_RELEASE = 0.06;

/** Per-voice estimator: keeps the voice's recent loudness peak, its (smoothed) vowel and loudness. */
export class VisemeEstimator {
  /** Last measurement, for debugging: level (dBFS), loudness 0–1 and formants. */
  last: { db: number; loud: number; formants?: [number, number] } = { db: -120, loud: 0 };
  private peakDb = -30;
  private lastVowel = new Float32Array(VISEME_COUNT);
  private vowel = new Float32Array(VISEME_COUNT);
  private loud = 0;
  /** The last three measured vowels: their median drops one-frame misreadings (a flicker of "ee" inside an "oo"). */
  private recent = [new Float32Array(VISEME_COUNT), new Float32Array(VISEME_COUNT), new Float32Array(VISEME_COUNT)];
  private recentIndex = 0;
  private median = new Float32Array(VISEME_COUNT);

  constructor() {
    this.lastVowel[0] = 1;
    this.vowel[0] = 1;
    for (const r of this.recent) r[0] = 1;
  }

  /** Smoothed viseme weights (0–1) for the latest block of samples; `dt` is the time since the last call. */
  estimate(samples: Float32Array, sampleRate: number, dt: number, out: Float32Array): Float32Array {
    let sq = 0;
    for (let i = 0; i < samples.length; i++) sq += samples[i] * samples[i];
    const db = 10 * Math.log10(sq / samples.length + 1e-12);

    this.peakDb = Math.max(db, this.peakDb - PEAK_DECAY_DB_PER_S * dt, SILENCE_DB + DYNAMIC_RANGE_DB);
    const floor = Math.max(SILENCE_DB, this.peakDb - DYNAMIC_RANGE_DB);
    let loud = Math.min(1, Math.max(0, (db - floor) / (this.peakDb - floor)));
    this.last = { db, loud };

    if (loud > 0) {
      // Consonants and noise often have no clear formants: keep the last vowel shape, just less open.
      const formants = estimateFormants(samples, sampleRate);
      this.last.formants = formants;
      if (formants) vowelWeights(formants[0], formants[1], this.lastVowel);
      else loud *= 0.6;
    }

    this.recent[this.recentIndex].set(this.lastVowel);
    this.recentIndex = (this.recentIndex + 1) % this.recent.length;
    for (let i = 0; i < VISEME_COUNT; i++) {
      const a = this.recent[0][i];
      const b = this.recent[1][i];
      const c = this.recent[2][i];
      this.median[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    }

    const step = (time: number) => 1 - Math.exp(-Math.max(dt, 0) / time);
    const kv = step(VOWEL_TIME);
    for (let i = 0; i < VISEME_COUNT; i++) this.vowel[i] += (this.median[i] - this.vowel[i]) * kv;
    this.loud += (loud - this.loud) * step(loud > this.loud ? LOUD_ATTACK : LOUD_RELEASE);
    if (this.loud < 0.003) this.loud = 0;

    for (let i = 0; i < out.length; i++) out[i] = this.vowel[i] * this.loud;
    return out;
  }
}
