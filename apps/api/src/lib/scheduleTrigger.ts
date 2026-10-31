import type { ScheduleInsertionMode, ScheduleTriggerType } from "@spectado/database";
import type { ScheduleTriggerDTO } from "@spectado/shared-types";

/** Prisma `@db.Time()` columns are plain Postgres TIME (no timezone) -- represented as a
 * JS Date at the 1970-01-01 epoch. Read/written here as UTC wall-clock minutes, same
 * convention as the wire format's "HH:mm" strings (see schedule-trigger.ts). */
export function parseTimeOfDay(hhmm: string): Date {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(1970, 0, 1, hours, minutes));
}

export function formatTimeOfDay(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Maps the wire-format ScheduleTriggerDTO fields to the Prisma scalar columns shared by
 * ScheduleRule and ExternalStream. Doesn't reset `lastTriggeredAt`/`playsSinceLastTrigger` --
 * callers decide separately whether an edit should restart the trigger's bookkeeping. */
export function triggerToPrismaData(trigger: ScheduleTriggerDTO) {
  return {
    triggerType: trigger.triggerType,
    insertionMode: trigger.insertionMode,
    runAt: trigger.runAt ? new Date(trigger.runAt) : null,
    weekdays: trigger.weekdays ?? [],
    timeOfDay: trigger.timeOfDay ? parseTimeOfDay(trigger.timeOfDay) : null,
    intervalMinutes: trigger.intervalMinutes ?? null,
    windowStart: trigger.windowStart ? parseTimeOfDay(trigger.windowStart) : null,
    windowEnd: trigger.windowEnd ? parseTimeOfDay(trigger.windowEnd) : null,
    everyNPlays: trigger.everyNPlays ?? null,
  };
}

interface PrismaTriggerFields {
  triggerType: ScheduleTriggerType;
  insertionMode: ScheduleInsertionMode;
  runAt: Date | null;
  weekdays: number[];
  timeOfDay: Date | null;
  intervalMinutes: number | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  everyNPlays: number | null;
}

export function triggerFromPrisma(row: PrismaTriggerFields): ScheduleTriggerDTO {
  return {
    triggerType: row.triggerType,
    insertionMode: row.insertionMode,
    runAt: row.runAt?.toISOString() ?? null,
    weekdays: row.weekdays,
    timeOfDay: row.timeOfDay ? formatTimeOfDay(row.timeOfDay) : null,
    intervalMinutes: row.intervalMinutes,
    windowStart: row.windowStart ? formatTimeOfDay(row.windowStart) : null,
    windowEnd: row.windowEnd ? formatTimeOfDay(row.windowEnd) : null,
    everyNPlays: row.everyNPlays,
  };
}

const TRIGGER_TIMING_KEYS = [
  "triggerType",
  "runAt",
  "weekdays",
  "timeOfDay",
  "intervalMinutes",
  "windowStart",
  "windowEnd",
  "everyNPlays",
] as const satisfies readonly (keyof ScheduleTriggerDTO)[];

/** Bookkeeping to spread into a PATCH when the trigger's timing actually changed: restarts the
 * play counter, and re-arms a ONE_TIME trigger (it's only ever due while `lastTriggeredAt` is
 * null -- without this, an already-fired one-time rule/stream edited to a new runAt silently
 * never fires again). WEEKLY/INTERVAL keep `lastTriggeredAt`: their catch-up is bounded by
 * MAX_TRIGGER_CATCH_UP_MS, and clearing it could re-fire an occurrence that just played. */
export function triggerBookkeepingOnEdit(existing: PrismaTriggerFields, next: ScheduleTriggerDTO) {
  const before = triggerFromPrisma(existing);
  const after = triggerFromPrisma(triggerToPrismaData(next));
  const changed = TRIGGER_TIMING_KEYS.some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  if (!changed) return {};
  return {
    playsSinceLastTrigger: 0,
    ...(after.triggerType === "ONE_TIME" ? { lastTriggeredAt: null } : {}),
  };
}
