import { z } from "zod";
import { MediaKindSchema } from "./common.js";
import { refineScheduleTrigger, ScheduleTriggerSchema } from "./schedule-trigger.js";

/** One ordered song/jingle/ad in a ScheduleRule's block. Denormalized title/artist/
 * durationMs, same convention as QueueEntrySchema, so the UI never N+1s back to the
 * library. */
export const ScheduleRuleItemSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  mediaKind: MediaKindSchema,
  mediaId: z.string(),
  title: z.string(),
  artist: z.string().nullable(),
  durationMs: z.number().int().positive(),
});
export type ScheduleRuleItemDTO = z.infer<typeof ScheduleRuleItemSchema>;

export const ScheduleRuleSchema = ScheduleTriggerSchema.extend({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  lastTriggeredAt: z.string().datetime().nullable(),
  items: z.array(ScheduleRuleItemSchema),
});
export type ScheduleRuleDTO = z.infer<typeof ScheduleRuleSchema>;

/** Create-and-replace-items, same "Upsert" convention as UpsertClockWheelRequestSchema:
 * used for both POST (create) and PATCH (update, replacing the whole item list). */
export const UpsertScheduleRuleRequestSchema = ScheduleTriggerSchema.extend({
  name: z.string().min(1),
  isActive: z.boolean().default(true),
  items: z
    .array(z.object({ mediaKind: MediaKindSchema, mediaId: z.string() }))
    .min(1, "a schedule rule needs at least one item"),
}).superRefine(refineScheduleTrigger);
export type UpsertScheduleRuleRequestDTO = z.infer<typeof UpsertScheduleRuleRequestSchema>;
