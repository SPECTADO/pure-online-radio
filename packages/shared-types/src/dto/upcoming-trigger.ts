import { z } from "zod";
import { ScheduleInsertionModeSchema } from "./common.js";

export const UpcomingTriggerKindSchema = z.enum(["SCHEDULE_RULE", "EXTERNAL_STREAM"]);
export type UpcomingTriggerKind = z.infer<typeof UpcomingTriggerKindSchema>;

/** A not-yet-fired ScheduleRule/ExternalStream trigger due within the next
 * `UPCOMING_TRIGGER_WINDOW_MS` (see apps/api/src/scheduler/constants.ts) -- a forward-looking
 * preview, not a real queue row. PLAY_COUNT triggers never appear here (no time basis for an
 * ETA); once a trigger actually fires it drops out of this list and (for ScheduleRule) shows up
 * as a real QueueEntryDTO from GET /queue instead. */
export const UpcomingTriggerSchema = z.object({
  kind: UpcomingTriggerKindSchema,
  id: z.string(),
  name: z.string(),
  expectedAt: z.string().datetime(),
  insertionMode: ScheduleInsertionModeSchema,
  itemCount: z.number().int().nonnegative().nullable(), // ScheduleRule's item count; null for EXTERNAL_STREAM
});
export type UpcomingTriggerDTO = z.infer<typeof UpcomingTriggerSchema>;
