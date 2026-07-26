/** How often the scheduler tick re-evaluates ScheduleRule/ExternalStream triggers. */
export const SCHEDULER_TICK_MS = 15_000;

/** How far ahead GET /queue/upcoming-triggers previews a not-yet-fired trigger. */
export const UPCOMING_TRIGGER_WINDOW_MS = 60 * 60 * 1000;
