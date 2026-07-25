import { useEffect, useState } from "react";

/** Live "ms remaining until targetMs" -- null if there's no target. Ticks every 500ms. */
export function useCountdownTo(targetMs: number | null): number | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (targetMs === null) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [targetMs]);

  if (targetMs === null) return null;
  return Math.max(0, targetMs - Date.now());
}
