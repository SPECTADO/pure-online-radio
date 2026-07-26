import { Router } from "express";
import { prisma } from "@spectado/database";
import { SeparationRulesSchema, UpdateSeparationRulesRequestSchema, type SeparationRulesDTO } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const separationRulesRoutes = Router();

separationRulesRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

function toSeparationRulesDTO(rule: {
  artistSeparationMinutes: number;
  albumSeparationMinutes: number;
  songSeparationMinutes: number;
  updatedAt: Date;
}): SeparationRulesDTO {
  return {
    artistSeparationMinutes: rule.artistSeparationMinutes,
    albumSeparationMinutes: rule.albumSeparationMinutes,
    songSeparationMinutes: rule.songSeparationMinutes,
    updatedAt: rule.updatedAt.toISOString(),
  };
}

separationRulesRoutes.get("/", async (_req, res) => {
  const rule = await prisma.separationRule.findFirst({ where: { scope: "GLOBAL" } });
  if (!rule) {
    res.status(404).json({ error: "global separation rule not seeded" });
    return;
  }

  res.json(SeparationRulesSchema.parse(toSeparationRulesDTO(rule)));
});

separationRulesRoutes.patch("/", async (req, res) => {
  const rule = await prisma.separationRule.findFirst({ where: { scope: "GLOBAL" } });
  if (!rule) {
    res.status(404).json({ error: "global separation rule not seeded" });
    return;
  }

  const parsed = UpdateSeparationRulesRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const updated = await prisma.separationRule.update({
    where: { id: rule.id },
    data: { ...parsed.data, updatedById: req.user!.id },
  });

  res.json(SeparationRulesSchema.parse(toSeparationRulesDTO(updated)));
});
