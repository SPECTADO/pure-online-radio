import pino from "pino";

/**
 * Process-wide pino logger. Deliberately does not depend on config.ts (which
 * validates env vars that may themselves be invalid at boot) so that a config
 * validation failure can still be logged cleanly before the process exits.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "encoder" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
