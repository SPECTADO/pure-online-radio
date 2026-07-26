import { logger } from "../logger.js";
import { SCHEDULER_TICK_MS } from "./constants.js";
import { evaluateExternalStreams } from "./externalStreamScheduler.js";
import { evaluateScheduleRules } from "./scheduleRuleScheduler.js";

/** Starts the scheduler tick and returns the timer so callers can clear it on shutdown --
 * same pattern as the encoder's statusPublisher.startHeartbeatLoop. */
export function startScheduler(): NodeJS.Timeout {
  return setInterval(() => {
    const now = new Date();
    evaluateScheduleRules(now).catch((err: unknown) => {
      logger.error({ err }, "schedule rule evaluation tick failed");
    });
    evaluateExternalStreams(now).catch((err: unknown) => {
      logger.error({ err }, "external stream evaluation tick failed");
    });
  }, SCHEDULER_TICK_MS);
}

export function stopScheduler(timer: NodeJS.Timeout): void {
  clearInterval(timer);
}
