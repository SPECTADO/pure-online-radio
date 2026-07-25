import { useEffect, useState } from "react";

export interface Countdown {
  /** Milliseconds remaining until `startedAt + durationMs`, clamped to >= 0. */
  remainingMs: number;
  /** 0..1 fraction of `durationMs` elapsed. */
  progress: number;
}

/** Live mm:ss-to-end + progress for anything with a `startedAt`/`durationMs`
 * pair (now-playing queue item, a standalone jingle) -- ticks every 500ms. */
export function useCountdown(startedAt: string | null, durationMs: number | null): Countdown | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!startedAt || !durationMs) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [startedAt, durationMs]);

  if (!startedAt || !durationMs) return null;

  const elapsed = Date.now() - new Date(startedAt).getTime();
  return {
    remainingMs: Math.max(0, durationMs - elapsed),
    progress: Math.min(1, Math.max(0, elapsed / durationMs)),
  };
}
