import { logger } from "../logger.js";
import { evaluateClockWheelFill } from "./clockWheelEngine.js";
import { SCHEDULER_TICK_MS } from "./constants.js";
import { evaluateExternalStreams } from "./externalStreamScheduler.js";
import { evaluateScheduleRules } from "./scheduleRuleScheduler.js";

/** Runs `task` unless its previous run is still in flight. setInterval doesn't wait for async
 * work, so without this a slow evaluator (a large initial / post-DELETE /queue/rotation clock-wheel
 * fill can exceed the 15s tick) would overlap with itself -- two fills computing the same coverage
 * and each planning the full horizon (doubled rotation, defeated separation rules). */
function nonOverlapping(name: string, task: (now: Date) => Promise<void>): (now: Date) => void {
  let running = false;
  return (now) => {
    if (running) {
      logger.debug({ task: name }, "previous scheduler run still in flight -- skipping this tick");
      return;
    }
    running = true;
    task(now)
      .catch((err: unknown) => {
        logger.error({ err }, `${name} tick failed`);
      })
      .finally(() => {
        running = false;
      });
  };
}

/** Starts the scheduler tick and returns the timer so callers can clear it on shutdown --
 * same pattern as the encoder's statusPublisher.startHeartbeatLoop. */
export function startScheduler(): NodeJS.Timeout {
  const scheduleRules = nonOverlapping("schedule rule evaluation", evaluateScheduleRules);
  const externalStreams = nonOverlapping("external stream evaluation", evaluateExternalStreams);
  const clockWheelFill = nonOverlapping("clock wheel fill", evaluateClockWheelFill);
  return setInterval(() => {
    const now = new Date();
    scheduleRules(now);
    externalStreams(now);
    clockWheelFill(now);
  }, SCHEDULER_TICK_MS);
}

export function stopScheduler(timer: NodeJS.Timeout): void {
  clearInterval(timer);
}
