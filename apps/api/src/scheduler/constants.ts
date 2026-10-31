/** How often the scheduler tick re-evaluates ScheduleRule/ExternalStream triggers. */
export const SCHEDULER_TICK_MS = 15_000;

/** How late a WEEKLY/INTERVAL occurrence may still fire. Covers ordinary tick jitter and a short
 * api restart, but stops a rule/stream created (or re-timed) *after* today's occurrence time from
 * "catching up" on it -- e.g. a "Mon 08:00" block created Monday 17:00 must not interrupt the
 * song on air 9 hours late; its first occurrence is next Monday, matching the upcoming preview.
 * ONE_TIME is deliberately exempt: a past-due runAt still fires once. */
export const MAX_TRIGGER_CATCH_UP_MS = 5 * 60 * 1000;

/** How far ahead GET /queue/upcoming-triggers previews a not-yet-fired trigger. */
export const UPCOMING_TRIGGER_WINDOW_MS = 60 * 60 * 1000;

/** Hard stop on how many ScheduledItem rows a single clockWheelEngine.evaluateClockWheelFill
 * tick will generate -- bounded in practice by horizon ÷ shortest real track length, but a
 * background tick loop needs a real ceiling regardless. Hitting this just means the fill
 * continues on the next tick, 15s later. */
export const MAX_CLOCK_WHEEL_FILL_ITEMS_PER_TICK = 200;
