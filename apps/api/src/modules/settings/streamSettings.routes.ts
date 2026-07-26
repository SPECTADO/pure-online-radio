import { Router } from "express";
import { prisma } from "@spectado/database";
import { StreamSettingsSchema, UpdateStreamSettingsRequestSchema } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { ensureStreamSettings, toStreamSettingsDTO } from "./streamSettings.js";

export const streamSettingsRoutes = Router();

streamSettingsRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

streamSettingsRoutes.get("/", async (_req, res) => {
  const settings = await ensureStreamSettings();
  res.json(StreamSettingsSchema.parse(toStreamSettingsDTO(settings)));
});

streamSettingsRoutes.patch("/", async (req, res) => {
  const existing = await ensureStreamSettings();

  const parsed = UpdateStreamSettingsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const updated = await prisma.streamSettings.update({
    where: { id: existing.id },
    data: { ...parsed.data, updatedById: req.user!.id },
  });

  res.json(StreamSettingsSchema.parse(toStreamSettingsDTO(updated)));
});
