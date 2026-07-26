import { z } from "zod";
import { ScheduleInsertionModeSchema, ScheduleTriggerTypeSchema, WeekdaySchema } from "./common.js";

const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm"); // "HH:mm", same convention as ClockWheelSlot

/**
 * The four trigger shapes a ScheduleRule/ExternalStream can fire on, plus how
 * insertion behaves once it does. See `refineScheduleTrigger` for the
 * per-triggerType required-field validation Prisma can't express.
 */
export const ScheduleTriggerSchema = z.object({
  triggerType: ScheduleTriggerTypeSchema,
  insertionMode: ScheduleInsertionModeSchema,
  runAt: z.string().datetime().nullable().optional(), // ONE_TIME
  weekdays: z.array(WeekdaySchema).optional(), // WEEKLY, INTERVAL
  timeOfDay: TimeOfDaySchema.nullable().optional(), // WEEKLY
  intervalMinutes: z.number().int().positive().nullable().optional(), // INTERVAL
  windowStart: TimeOfDaySchema.nullable().optional(), // INTERVAL, null = from midnight
  windowEnd: TimeOfDaySchema.nullable().optional(), // INTERVAL, null = to end of day
  everyNPlays: z.number().int().positive().nullable().optional(), // PLAY_COUNT
});
export type ScheduleTriggerDTO = z.infer<typeof ScheduleTriggerSchema>;

/** Enforces "required fields present for this triggerType" -- Prisma can't express this
 * as a schema-level constraint, same rationale as ScheduledItem's mediaKind/media-FK
 * constraint being app-layer only. Shared by CreateScheduleRule and CreateExternalStream
 * request schemas via `.superRefine()`. */
export function refineScheduleTrigger(data: ScheduleTriggerDTO, ctx: z.RefinementCtx): void {
  switch (data.triggerType) {
    case "ONE_TIME":
      if (!data.runAt) {
        ctx.addIssue({ code: "custom", message: "runAt is required for a ONE_TIME trigger", path: ["runAt"] });
      }
      break;
    case "WEEKLY":
      if (!data.weekdays?.length) {
        ctx.addIssue({ code: "custom", message: "weekdays is required for a WEEKLY trigger", path: ["weekdays"] });
      }
      if (!data.timeOfDay) {
        ctx.addIssue({ code: "custom", message: "timeOfDay is required for a WEEKLY trigger", path: ["timeOfDay"] });
      }
      break;
    case "INTERVAL":
      if (!data.intervalMinutes) {
        ctx.addIssue({
          code: "custom",
          message: "intervalMinutes is required for an INTERVAL trigger",
          path: ["intervalMinutes"],
        });
      }
      break;
    case "PLAY_COUNT":
      if (!data.everyNPlays) {
        ctx.addIssue({
          code: "custom",
          message: "everyNPlays is required for a PLAY_COUNT trigger",
          path: ["everyNPlays"],
        });
      }
      break;
  }
}
