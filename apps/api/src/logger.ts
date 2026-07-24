import pino from "pino";
import { config } from "./config/env.js";

/** Process-wide pino instance. `pino-http` (in app.ts) wraps this same logger for per-request logs. */
export const logger = pino({
  level: config.isProduction ? "info" : "debug",
});
