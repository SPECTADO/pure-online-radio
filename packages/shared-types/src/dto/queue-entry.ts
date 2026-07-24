import { z } from "zod";
import { MediaKindSchema, ScheduledItemStatusSchema } from "./common.js";

/** A manager-queued or time-scheduled one-off item ("play this at/after time T"). */
export const QueueEntrySchema = z.object({
  id: z.string(),
  mediaKind: MediaKindSchema,
  mediaId: z.string(),
  scheduledFor: z.string().datetime().nullable(), // null = "as soon as due"
  status: ScheduledItemStatusSchema,
  addedAt: z.string().datetime(),
});
export type QueueEntryDTO = z.infer<typeof QueueEntrySchema>;

export const CreateQueueEntryRequestSchema = z.object({
  mediaKind: MediaKindSchema,
  mediaId: z.string(),
  scheduledFor: z.string().datetime().nullable().optional(),
});
export type CreateQueueEntryRequestDTO = z.infer<typeof CreateQueueEntryRequestSchema>;
