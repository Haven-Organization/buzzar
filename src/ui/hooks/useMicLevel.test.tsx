/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react-hooks";

import { SPEAKING_LEVEL, useSpeaking } from "./useMicLevel";

describe("useSpeaking", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("turns off after the hold even while quiet levels keep changing", () => {
    const { result, rerender } = renderHook(({ level }) => useSpeaking(level, 300), { initialProps: { level: 0 } });
    rerender({ level: SPEAKING_LEVEL * 2 });
    expect(result.current).toBe(true);
    // Background noise: a slightly different quiet level every 66 ms.
    for (let i = 0; i < 10; i++) {
      act(() => {
        vi.advanceTimersByTime(66);
      });
      rerender({ level: 0.001 + i * 0.0001 });
    }
    expect(result.current).toBe(false);
  });

  it("stays on while loud", () => {
    const { result, rerender } = renderHook(({ level }) => useSpeaking(level, 300), { initialProps: { level: 0 } });
    for (let i = 0; i < 10; i++) {
      rerender({ level: SPEAKING_LEVEL * (2 + i * 0.01) });
      act(() => {
        vi.advanceTimersByTime(66);
      });
    }
    expect(result.current).toBe(true);
  });
});
