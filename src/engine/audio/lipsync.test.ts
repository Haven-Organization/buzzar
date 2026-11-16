import { estimateVisemes } from "./lipsync.main";

const SAMPLE_RATE = 48000;
const N = 1024;
const BIN = SAMPLE_RATE / N;

/** A waveform of summed sines and its (rough) dB spectrum, like an AnalyserNode would give. */
function voice(freqs: number[], amplitude: number) {
  const time = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    for (const f of freqs) time[i] += (amplitude / freqs.length) * Math.sin((2 * Math.PI * f * i) / SAMPLE_RATE);
  }
  const freq = new Float32Array(N / 2).fill(-120);
  for (const f of freqs) freq[Math.round(f / BIN)] = 20 * Math.log10(amplitude / freqs.length);
  return { time, freq };
}

const weights = (freqs: number[], amplitude = 0.3) => {
  const { time, freq } = voice(freqs, amplitude);
  return Array.from(estimateVisemes(time, freq, BIN, new Float32Array(5)));
};
const argmax = (v: number[]) => v.indexOf(Math.max(...v));

describe("viseme estimation", () => {
  it("keeps the mouth closed when quiet", () => {
    expect(weights([700], 0.001)).toEqual([0, 0, 0, 0, 0]);
  });

  it("opens wider for louder speech", () => {
    const quiet = weights([700, 1200], 0.02).reduce((a, b) => a + b, 0);
    const loud = weights([700, 1200], 0.3).reduce((a, b) => a + b, 0);
    expect(loud).toBeGreaterThan(quiet);
    expect(loud).toBeLessThanOrEqual(1.0001);
  });

  it("picks open 'aa' for mid formants, 'ih' for bright ones and 'ou' for dark ones", () => {
    expect(argmax(weights([800]))).toBe(0); // aa
    expect(argmax(weights([2400]))).toBe(1); // ih
    expect(argmax(weights([300]))).toBe(2); // ou
  });
});
