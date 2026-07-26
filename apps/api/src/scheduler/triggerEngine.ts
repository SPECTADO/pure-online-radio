import type { ScheduleTriggerType } from "@spectado/shared-types";

/** The scalar trigger fields shared by ScheduleRule and ExternalStream (see schema.prisma).
 * `timeOfDay`/`windowStart`/`windowEnd` are Prisma `@db.Time()` values -- plain Postgres TIME,
 * no timezone -- read here as UTC wall-clock minutes, same convention ClockWheelSlot already
 * uses for its start/end times. */
export interface TimeTrigger {
  triggerType: ScheduleTriggerType;
  runAt: Date | null;
  weekdays: number[];
  timeOfDay: Date | null;
  intervalMinutes: number | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  lastTriggeredAt: Date | null;
}

function utcMinutesSinceMidnight(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** `now`'s calendar date, at `minutes` past UTC midnight. */
function instantAtUtcMinutes(now: Date, minutes: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, minutes));
}

/** `now`'s calendar date plus `dayOffset` days, at `minutes` past UTC midnight -- `Date.UTC`
 * rolls month/year boundaries over correctly, so `dayOffset` isn't bounded to the current month. */
function instantAtDayOffset(now: Date, dayOffset: number, minutes: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, 0, minutes));
}

/**
 * Due-check for the 3 time-based trigger types (ONE_TIME/WEEKLY/INTERVAL). PLAY_COUNT is
 * event-driven (see scheduleRuleScheduler.incrementSongPlayCountAndFire), not tick-based,
 * so it's not handled here -- always returns false for it.
 */
export function isTimeTriggerDue(trigger: TimeTrigger, now: Date): boolean {
  switch (trigger.triggerType) {
    case "ONE_TIME":
      return trigger.runAt !== null && trigger.runAt <= now && trigger.lastTriggeredAt === null;

    case "WEEKLY": {
      if (!trigger.timeOfDay || trigger.weekdays.length === 0) return false;
      if (!trigger.weekdays.includes(now.getUTCDay())) return false;
      const todayInstant = instantAtUtcMinutes(now, utcMinutesSinceMidnight(trigger.timeOfDay));
      if (now < todayInstant) return false;
      return trigger.lastTriggeredAt === null || trigger.lastTriggeredAt < todayInstant;
    }

    case "INTERVAL": {
      if (!trigger.intervalMinutes) return false;
      if (trigger.weekdays.length > 0 && !trigger.weekdays.includes(now.getUTCDay())) return false;

      const windowStartMin = trigger.windowStart ? utcMinutesSinceMidnight(trigger.windowStart) : 0;
      const windowEndMin = trigger.windowEnd ? utcMinutesSinceMidnight(trigger.windowEnd) : 24 * 60;
      const nowMin = utcMinutesSinceMidnight(now);
      if (nowMin < windowStartMin || nowMin >= windowEndMin) return false;

      const bucketIndex = Math.floor((nowMin - windowStartMin) / trigger.intervalMinutes);
      const bucketInstant = instantAtUtcMinutes(now, windowStartMin + bucketIndex * trigger.intervalMinutes);
      if (now < bucketInstant) return false;
      return trigger.lastTriggeredAt === null || trigger.lastTriggeredAt < bucketInstant;
    }

    case "PLAY_COUNT":
      return false;
  }
}

const DAY_SEARCH_HORIZON = 7; // enough to guarantee covering a full week for WEEKLY/INTERVAL

function computeNextWeeklyOccurrence(trigger: TimeTrigger, now: Date): Date | null {
  if (!trigger.timeOfDay || trigger.weekdays.length === 0) return null;
  const minutes = utcMinutesSinceMidnight(trigger.timeOfDay);

  for (let dayOffset = 0; dayOffset <= DAY_SEARCH_HORIZON; dayOffset++) {
    const candidateWeekday = instantAtDayOffset(now, dayOffset, 0).getUTCDay();
    if (!trigger.weekdays.includes(candidateWeekday)) continue;

    const candidate = instantAtDayOffset(now, dayOffset, minutes);
    if (candidate <= now) continue;
    if (trigger.lastTriggeredAt && candidate <= trigger.lastTriggeredAt) continue;
    return candidate;
  }
  return null;
}

function computeNextIntervalOccurrence(trigger: TimeTrigger, now: Date): Date | null {
  if (!trigger.intervalMinutes) return null;
  const windowStartMin = trigger.windowStart ? utcMinutesSinceMidnight(trigger.windowStart) : 0;
  const windowEndMin = trigger.windowEnd ? utcMinutesSinceMidnight(trigger.windowEnd) : 24 * 60;
  if (windowStartMin >= windowEndMin) return null;

  const intervalMs = trigger.intervalMinutes * 60_000;

  for (let dayOffset = 0; dayOffset <= DAY_SEARCH_HORIZON; dayOffset++) {
    const candidateWeekday = instantAtDayOffset(now, dayOffset, 0).getUTCDay();
    if (trigger.weekdays.length > 0 && !trigger.weekdays.includes(candidateWeekday)) continue;

    const windowStartInstant = instantAtDayOffset(now, dayOffset, windowStartMin);
    const windowEndInstant = instantAtDayOffset(now, dayOffset, windowEndMin);
    const searchFrom = windowStartInstant > now ? windowStartInstant : now;
    // windowEnd is exclusive, matching isTimeTriggerDue's `nowMin >= windowEndMin` convention.
    if (searchFrom >= windowEndInstant) continue; // this day's window has already fully elapsed

    let bucketIndex = Math.ceil((searchFrom.getTime() - windowStartInstant.getTime()) / intervalMs);
    let candidate = new Date(windowStartInstant.getTime() + bucketIndex * intervalMs);
    if (candidate <= now) {
      bucketIndex += 1;
      candidate = new Date(windowStartInstant.getTime() + bucketIndex * intervalMs);
    }
    while (trigger.lastTriggeredAt && candidate <= trigger.lastTriggeredAt) {
      candidate = new Date(candidate.getTime() + intervalMs);
    }

    if (candidate < windowEndInstant) return candidate;
    // else no bucket left in this day's window -- fall through to the next dayOffset
  }
  return null;
}

/**
 * The forward-looking counterpart to `isTimeTriggerDue`: "when will this next fire", not "is it
 * due right now". Used to preview not-yet-fired ScheduleRule/ExternalStream triggers (see
 * `GET /queue/upcoming-triggers`) -- PLAY_COUNT has no time basis and is never previewed this way.
 */
export function computeNextOccurrence(trigger: TimeTrigger, now: Date): Date | null {
  switch (trigger.triggerType) {
    case "ONE_TIME":
      return trigger.lastTriggeredAt === null && trigger.runAt !== null && trigger.runAt > now
        ? trigger.runAt
        : null;
    case "WEEKLY":
      return computeNextWeeklyOccurrence(trigger, now);
    case "INTERVAL":
      return computeNextIntervalOccurrence(trigger, now);
    case "PLAY_COUNT":
      return null;
  }
}
