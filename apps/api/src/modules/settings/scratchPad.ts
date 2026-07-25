import { prisma } from "@spectado/database";
import { SCRATCH_PAD_SLOT_COUNT, type ScratchPadDTO, type ScratchPadSlotDTO } from "@spectado/shared-types";

function emptySlots(): ScratchPadSlotDTO[] {
  return Array.from({ length: SCRATCH_PAD_SLOT_COUNT }, (_, position) => ({ position, jingleId: null }));
}

/** There's only ever one scratch pad -- app enforces a single row via
 * findFirst-or-create, same pattern as StationSettings. */
export async function ensureScratchPad() {
  const existing = await prisma.scratchPad.findFirst();
  if (existing) return existing;
  return prisma.scratchPad.create({ data: { slots: emptySlots() } });
}

export function toScratchPadDTO(row: { slots: unknown; updatedAt: Date }): ScratchPadDTO {
  return {
    slots: (row.slots as ScratchPadSlotDTO[] | null) ?? emptySlots(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
