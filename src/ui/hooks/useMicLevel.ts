import { useEffect, useRef, useState } from "react";

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

/**
 * Whether a level reads as speech, with a short hold so the indicator doesn't flicker between words.
 * Only loud samples reset the hold: the level changes many times a second even when quiet, so a timer that
 * restarted on every change would never run out and the indicator would stay on.
 */
export function useSpeaking(level: number, holdMs = 300): boolean {
  const [speaking, setSpeaking] = useState(false);
  const lastLoud = useRef(0);

  useEffect(() => {
    if (level >= SPEAKING_LEVEL) {
      lastLoud.current = Date.now();
      setSpeaking(true);
    }
  }, [level]);

  useEffect(() => {
    if (!speaking) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastLoud.current > holdMs) setSpeaking(false);
    }, 100);
    return () => window.clearInterval(timer);
  }, [speaking, holdMs]);

  return speaking;
}
