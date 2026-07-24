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
