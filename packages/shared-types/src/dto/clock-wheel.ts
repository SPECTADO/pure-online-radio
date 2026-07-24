import { z } from "zod";
import { MediaKindSchema, SelectionStrategySchema, WeekdaySchema } from "./common.js";

export const PickRuleSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  mediaKind: MediaKindSchema,
  selectionStrategy: SelectionStrategySchema,
  categoryId: z.string().nullable(), // required in practice when mediaKind = SONG
  tag: z.string().nullable(),
});
export type PickRuleDTO = z.infer<typeof PickRuleSchema>;

export const ClockWheelSlotSchema = z.object({
  id: z.string(),
  weekdays: z.array(WeekdaySchema),
  startTime: z.string(), // "HH:mm"
  endTime: z.string(), // "HH:mm"
});
export type ClockWheelSlotDTO = z.infer<typeof ClockWheelSlotSchema>;

export const ClockWheelSchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  slots: z.array(ClockWheelSlotSchema),
  steps: z.array(PickRuleSchema),
});
export type ClockWheelDTO = z.infer<typeof ClockWheelSchema>;

export const UpsertClockWheelRequestSchema = z.object({
  name: z.string().min(1),
  isActive: z.boolean().default(true),
  slots: z.array(ClockWheelSlotSchema.omit({ id: true })),
  steps: z.array(PickRuleSchema.omit({ id: true })),
});
export type UpsertClockWheelRequestDTO = z.infer<typeof UpsertClockWheelRequestSchema>;
