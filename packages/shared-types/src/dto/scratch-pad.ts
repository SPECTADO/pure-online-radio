import { z } from "zod";

export const SCRATCH_PAD_SLOT_COUNT = 10;

export const ScratchPadSlotSchema = z.object({
  position: z.number().int().min(0).max(SCRATCH_PAD_SLOT_COUNT - 1),
  jingleId: z.string().nullable(),
});
export type ScratchPadSlotDTO = z.infer<typeof ScratchPadSlotSchema>;

export const ScratchPadSchema = z.object({
  slots: z.array(ScratchPadSlotSchema).length(SCRATCH_PAD_SLOT_COUNT),
  updatedAt: z.string().datetime(),
});
export type ScratchPadDTO = z.infer<typeof ScratchPadSchema>;

export const UpdateScratchPadRequestSchema = z.object({
  slots: z.array(ScratchPadSlotSchema).length(SCRATCH_PAD_SLOT_COUNT),
});
export type UpdateScratchPadRequestDTO = z.infer<typeof UpdateScratchPadRequestSchema>;
