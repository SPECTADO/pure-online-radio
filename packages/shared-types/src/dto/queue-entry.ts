import { z } from "zod";
import { MediaKindSchema, ScheduledItemStatusSchema } from "./common.js";

/** A manager-queued or time-scheduled one-off item ("play this at/after time T"). */
export const QueueEntrySchema = z.object({
  id: z.string(),
  mediaKind: MediaKindSchema,
  mediaId: z.string(),
  // Denormalized for display so the queue/dashboard UI never has to N+1 back
  // to the library for a title -- artist is null for jingles/ads (neither has one).
  title: z.string(),
  artist: z.string().nullable(),
  durationMs: z.number().int().positive(),
  scheduledFor: z.string().datetime().nullable(), // null = "as soon as due" (the manual queue)
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
