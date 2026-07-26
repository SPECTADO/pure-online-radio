import { Router } from "express";
import { Prisma, prisma } from "@spectado/database";
import { StationSettingsSchema, UpdateStationSettingsRequestSchema } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { stationLogoUpload } from "../../middleware/upload.js";
import { optionalStringField } from "../../lib/multipartFields.js";
import { deleteObject, extensionFor, stationLogoKey, uploadObject } from "../../lib/storage.js";
import { ensureStationSettings, toStationSettingsDTO } from "./stationSettings.js";

export const stationRoutes = Router();

stationRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

stationRoutes.get("/", async (_req, res) => {
  const settings = await ensureStationSettings();
  res.json(StationSettingsSchema.parse(toStationSettingsDTO(settings)));
});

// Genuinely partial: a field left out of the request body keeps its current
// DB value rather than falling back to a hardcoded default. Needed because
// the queue-planning horizon is edited from its own form on the Queue Rules
// page, which only ever sends that one field -- not the full station form.
stationRoutes.patch("/", stationLogoUpload, async (req, res) => {
  const existing = await ensureStationSettings();

  const parsed = UpdateStationSettingsRequestSchema.safeParse({
    name: optionalStringField(req.body.name) ?? existing.name,
    description:
      req.body.description === "" ? null : optionalStringField(req.body.description) ?? existing.description,
    links: req.body.links ? JSON.parse(req.body.links) : existing.links,
    removeLogo: req.body.removeLogo === "true",
    timeFormat: optionalStringField(req.body.timeFormat) ?? existing.timeFormat,
    queuePlanningHorizonMinutes:
      optionalStringField(req.body.queuePlanningHorizonMinutes) ?? String(existing.queuePlanningHorizonMinutes),
  });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const data: Prisma.StationSettingsUncheckedUpdateInput = {
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    links: parsed.data.links as Prisma.InputJsonValue,
    timeFormat: parsed.data.timeFormat,
    queuePlanningHorizonMinutes: parsed.data.queuePlanningHorizonMinutes,
  };

  const logoFile = req.file;
  const oldLogoKey = existing.logoKey;
  let newLogoKey: string | null = null;
  if (logoFile) {
    newLogoKey = stationLogoKey(extensionFor(logoFile.originalname, logoFile.mimetype));
    await uploadObject(newLogoKey, logoFile.buffer, logoFile.mimetype);
    data.logoKey = newLogoKey;
    data.logoMimeType = logoFile.mimetype;
  } else if (parsed.data.removeLogo) {
    data.logoKey = null;
    data.logoMimeType = null;
  }

  try {
    const updated = await prisma.stationSettings.update({
      where: { id: existing.id },
      data: { ...data, updatedById: req.user!.id },
    });
    if (newLogoKey && oldLogoKey && oldLogoKey !== newLogoKey) {
      await deleteObject(oldLogoKey).catch(() => {});
    } else if (parsed.data.removeLogo && oldLogoKey) {
      await deleteObject(oldLogoKey).catch(() => {});
    }
    res.json(StationSettingsSchema.parse(toStationSettingsDTO(updated)));
  } catch (err) {
    if (newLogoKey) await deleteObject(newLogoKey).catch(() => {});
    throw err;
  }
});
