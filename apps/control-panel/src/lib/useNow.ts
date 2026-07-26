import { useEffect, useState } from "react";

/** Live current time in epoch ms -- ticks every 250ms so a seconds-resolution
 * clock display never visibly skips a second. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  return now;
}
