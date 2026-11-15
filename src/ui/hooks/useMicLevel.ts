import { useEffect, useState } from "react";

/** RMS level (0–1) above which we treat the mic as picking up speech. */
export const SPEAKING_LEVEL = 0.04;

/**
 * Buzzar: live input level of a microphone stream (0–1, roughly), measured with a Web Audio analyser about 15
 * times a second. Returns 0 while there's no stream, the track is disabled (muted) or ended.
 */
export function useMicLevel(stream: MediaStream | undefined): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    setLevel(0);
    const track = stream?.getAudioTracks()[0];
    if (!stream || !track) return;

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const timer = window.setInterval(() => {
      if (context.state === "suspended") context.resume().catch(() => {});
      if (!track.enabled || track.readyState !== "live") {
        setLevel(0);
        return;
      }
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      setLevel(Math.min(1, Math.sqrt(sum / samples.length)));
    }, 66);

    return () => {
      window.clearInterval(timer);
      source.disconnect();
      context.close().catch(() => {});
    };
  }, [stream]);

  return level;
}

/** Whether a level reads as speech, with a short hold so the indicator doesn't flicker between words. */
export function useSpeaking(level: number, holdMs = 300): boolean {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (level >= SPEAKING_LEVEL) {
      setSpeaking(true);
      return;
    }
    const timer = window.setTimeout(() => setSpeaking(false), holdMs);
    return () => window.clearTimeout(timer);
  }, [level, holdMs]);
  return speaking;
}
