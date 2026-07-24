import { Router } from "express";
import { prisma } from "@spectado/database";
import { SeparationRulesSchema, type SeparationRulesDTO } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { notImplemented } from "../../lib/notImplemented.js";

export const separationRulesRoutes = Router();

separationRulesRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

separationRulesRoutes.get("/", async (_req, res) => {
  const rule = await prisma.separationRule.findFirst({ where: { scope: "GLOBAL" } });
  if (!rule) {
    res.status(404).json({ error: "global separation rule not seeded" });
    return;
  }

  const dto: SeparationRulesDTO = {
    artistSeparationMinutes: rule.artistSeparationMinutes,
    songSeparationMinutes: rule.songSeparationMinutes,
    updatedAt: rule.updatedAt.toISOString(),
  };
  res.json(SeparationRulesSchema.parse(dto));
});

separationRulesRoutes.patch(
  "/",
  notImplemented(
    "validate UpdateSeparationRulesRequestDTO, update the GLOBAL SeparationRule row, stamp updatedById",
  ),
);
