// Named import, not default: ioredis's default-export typing doesn't resolve
// cleanly under NodeNext module resolution ("This expression is not
// constructable"); the named `Redis` export is properly typed instead.
import { Redis } from "ioredis";
import { config } from "../config/env.js";
import { logger } from "../logger.js";

/** ioredis auto-connects on construction; no explicit .connect() call needed. */
export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
});

redis.on("error", (err) => {
  logger.error({ err }, "[redis] connection error");
});

redis.on("connect", () => {
  logger.info("[redis] connected");
});

/** Used by the system status page. Returns null if redis is unreachable or
 * the INFO reply doesn't include the field (should never happen on a real
 * Redis server, but this is best-effort diagnostic data, not load-bearing). */
export async function getRedisUptimeSec(): Promise<number | null> {
  try {
    const info = await redis.info("server");
    const match = /uptime_in_seconds:(\d+)/.exec(info);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}
