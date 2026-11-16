import { estimateFormants, VisemeEstimator, vowelWeights } from "./visemes";

const RATE = 48000;
const N = 1024;

/**
 * A synthetic vowel: harmonics of a pitch, shaped by two formant resonances (a crude but standard source–filter
 * model). `f0` is the pitch, `f1`/`f2` the formants.
 */
function vowel(f1: number, f2: number, f0 = 120, amplitude = 0.3, phase = 0): Float32Array {
  const out = new Float32Array(N);
  const resonance = (f: number, fc: number, bw: number) => 1 / Math.sqrt((1 - (f / fc) ** 2) ** 2 + ((f * bw) / (fc * fc)) ** 2);
  for (let h = 1; h * f0 < 5000; h++) {
    const f = h * f0;
    const gain = resonance(f, f1, 80) * resonance(f, f2, 120) / h; // falling source spectrum
    for (let i = 0; i < N; i++) out[i] += gain * Math.sin((2 * Math.PI * f * (i + phase)) / RATE);
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < N; i++) out[i] *= amplitude / peak;
  return out;
}

const NAMES = ["aa", "ih", "ou", "ee", "oh"];
const VOWELS: Record<string, [number, number]> = { aa: [750, 1250], ih: [310, 2500], ou: [330, 950], ee: [620, 2050], oh: [450, 850] };
const argmax = (v: ArrayLike<number>) => Array.from(v).indexOf(Math.max(...Array.from(v)));

describe("formants", () => {
  it.each(Object.entries(VOWELS))("finds F1/F2 of %s", (_name, [f1, f2]) => {
    const found = estimateFormants(vowel(f1, f2), RATE)!;
    expect(found).toBeDefined();
    expect(Math.abs(Math.log(found[0] / f1))).toBeLessThan(0.25);
    expect(Math.abs(Math.log(found[1] / f2))).toBeLessThan(0.2);
  });

  it("works for a higher-pitched voice too", () => {
    const found = estimateFormants(vowel(320, 2500, 220), RATE)!;
    expect(NAMES[argmax(vowelWeights(found[0], found[1], new Float32Array(5)))]).toBe("ih");
  });
});

describe("visemes", () => {
  it.each(Object.keys(VOWELS))("picks %s for that vowel", (name) => {
    const [f1, f2] = VOWELS[name];
    const est = new VisemeEstimator();
    const out = new Float32Array(5);
    for (let i = 0; i < 12; i++) est.estimate(vowel(f1, f2), RATE, 1 / 60, out);
    expect(NAMES[argmax(out)]).toBe(name);
    // It commits to the shape rather than blending them all.
    const sorted = Array.from(out).sort((a, b) => b - a);
    expect(sorted[1]).toBeLessThan(sorted[0] * 0.5);
  });

  it("closes for silence and opens with each syllable relative to the voice's own level", () => {
    const est = new VisemeEstimator();
    const run = (samples: Float32Array, frames = 12) => {
      const out = new Float32Array(5);
      for (let i = 0; i < frames; i++) est.estimate(samples, RATE, 1 / 60, out);
      return out;
    };
    const loud = run(vowel(750, 1250, 120, 0.3));
    const softer = run(vowel(750, 1250, 120, 0.05));
    const silent = run(new Float32Array(N), 30);
    expect(loud[0]).toBeGreaterThan(0.8);
    expect(softer[0]).toBeLessThan(loud[0] * 0.8);
    expect(Array.from(silent)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("fast vowel changes", () => {
  it("gives each short vowel of 'oo-ee-oo-ah-ah' (about 150 ms each) its own shape", () => {
    const est = new VisemeEstimator();
    const out = new Float32Array(5);
    const seq = ["ou", "ih", "ou", "aa", "aa"];
    const frames = 9; // 150 ms at 60 fps
    for (const name of seq) {
      const [f1, f2] = VOWELS[name];
      const shapes: string[] = [];
      for (let i = 0; i < frames; i++) {
        est.estimate(vowel(f1, f2, 140, 0.3, i * 800), RATE, 1 / 60, out);
        shapes.push(NAMES[argmax(out)]);
      }
      // Within a couple of frames (~35 ms) of the vowel starting, its shape leads.
      expect(shapes.slice(2)).toEqual(Array(frames - 2).fill(name));
    }
  });
});
