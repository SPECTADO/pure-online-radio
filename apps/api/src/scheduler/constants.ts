/** How often the scheduler tick re-evaluates ScheduleRule/ExternalStream triggers. */
export const SCHEDULER_TICK_MS = 15_000;

/** How far ahead GET /queue/upcoming-triggers previews a not-yet-fired trigger. */
export const UPCOMING_TRIGGER_WINDOW_MS = 60 * 60 * 1000;

/** Hard stop on how many ScheduledItem rows a single clockWheelEngine.evaluateClockWheelFill
 * tick will generate -- bounded in practice by horizon ÷ shortest real track length, but a
 * background tick loop needs a real ceiling regardless. Hitting this just means the fill
 * continues on the next tick, 15s later. */
export const MAX_CLOCK_WHEEL_FILL_ITEMS_PER_TICK = 200;
