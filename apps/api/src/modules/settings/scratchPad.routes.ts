import { Router } from "express";
import { Prisma, prisma } from "@spectado/database";
import { ScratchPadSchema, UpdateScratchPadRequestSchema } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { ensureScratchPad, toScratchPadDTO } from "./scratchPad.js";

export const scratchPadRoutes = Router();

scratchPadRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

scratchPadRoutes.get("/", async (_req, res) => {
  const scratchPad = await ensureScratchPad();
  res.json(ScratchPadSchema.parse(toScratchPadDTO(scratchPad)));
});

scratchPadRoutes.put("/", async (req, res) => {
  const parsed = UpdateScratchPadRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const positions = new Set(parsed.data.slots.map((slot) => slot.position));
  if (positions.size !== parsed.data.slots.length) {
    res.status(400).json({ error: "slots must have unique positions" });
    return;
  }

  const jingleIds = parsed.data.slots.map((slot) => slot.jingleId).filter((id): id is string => id !== null);
  if (jingleIds.length > 0) {
    const found = await prisma.jingle.findMany({ where: { id: { in: jingleIds } }, select: { id: true } });
    if (found.length !== new Set(jingleIds).size) {
      res.status(400).json({ error: "one or more assigned jingles do not exist" });
      return;
    }
  }

  const existing = await ensureScratchPad();
  const updated = await prisma.scratchPad.update({
    where: { id: existing.id },
    data: {
      slots: parsed.data.slots as Prisma.InputJsonValue,
      updatedById: req.user!.id,
    },
  });
  res.json(ScratchPadSchema.parse(toScratchPadDTO(updated)));
});
