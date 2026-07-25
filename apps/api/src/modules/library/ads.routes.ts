import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { Prisma, prisma } from "@spectado/database";
import { AdSchema, CreateAdRequestSchema, UpdateAdRequestSchema, type AdDTO } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { audioUpload } from "../../middleware/upload.js";
import { extractAudioMetadata } from "../../lib/audioMetadata.js";
import { optionalStringField } from "../../lib/multipartFields.js";
import { adAudioKey, deleteObject, extensionFor, uploadObject } from "../../lib/storage.js";
import { streamAudioResponse } from "../../lib/streamAudioResponse.js";
import { ensureAllCategoryId } from "./allCategory.js";

export const adsRoutes = Router();

adsRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

const adInclude = { categories: true } satisfies Prisma.AdInclude;
type AdWithIncludes = Prisma.AdGetPayload<{ include: typeof adInclude }>;

function toAdDTO(ad: AdWithIncludes): AdDTO {
  return {
    id: ad.id,
    title: ad.title,
    durationMs: ad.durationMs,
    activeFrom: ad.activeFrom.toISOString(),
    activeUntil: ad.activeUntil.toISOString(),
    categories: ad.categories.map((c) => ({ id: c.id, name: c.name })),
    isActive: ad.isActive,
    createdAt: ad.createdAt.toISOString(),
  };
}

adsRoutes.get("/", async (_req, res) => {
  const ads = await prisma.ad.findMany({ include: adInclude, orderBy: { activeFrom: "desc" } });
  res.json(ads.map((ad) => AdSchema.parse(toAdDTO(ad))));
});

adsRoutes.get("/:id", async (req, res) => {
  const ad = await prisma.ad.findUnique({ where: { id: req.params.id }, include: adInclude });
  if (!ad) {
    res.status(404).json({ error: "ad not found" });
    return;
  }
  res.json(AdSchema.parse(toAdDTO(ad)));
});

// For control-panel audio preview -- streamed (not a direct MinIO URL, which
// a browser can never reach) with Range pass-through so <audio> can seek.
adsRoutes.get("/:id/audio", async (req, res) => {
  const ad = await prisma.ad.findUnique({
    where: { id: req.params.id },
    select: { fileKey: true, fileMimeType: true },
  });
  if (!ad) {
    res.status(404).json({ error: "ad not found" });
    return;
  }
  await streamAudioResponse(req, res, ad.fileKey, ad.fileMimeType);
});

adsRoutes.post("/", audioUpload, async (req, res) => {
  const audioFile = req.file;
  if (!audioFile) {
    res.status(400).json({ error: "an audio file ('file' field) is required" });
    return;
  }

  const parsed = CreateAdRequestSchema.safeParse({
    title: optionalStringField(req.body.title),
    activeFrom: req.body.activeFrom,
    activeUntil: req.body.activeUntil,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const id3 = await extractAudioMetadata(audioFile.buffer, audioFile.mimetype);
  const fallbackTitle = audioFile.originalname.replace(/\.[^.]+$/, "");
  const title = parsed.data.title ?? id3.title ?? fallbackTitle;

  const id = randomUUID();
  const audioKey = adAudioKey(id, extensionFor(audioFile.originalname, audioFile.mimetype));
  await uploadObject(audioKey, audioFile.buffer, audioFile.mimetype);

  try {
    // Ads never take manager-chosen categories -- always exactly "ALL" (see
    // the Ad model comment in schema.prisma).
    const allCategoryId = await ensureAllCategoryId();
    const ad = await prisma.ad.create({
      data: {
        id,
        title,
        durationMs: id3.durationMs,
        fileKey: audioKey,
        fileMimeType: audioFile.mimetype,
        fileSizeBytes: audioFile.size,
        activeFrom: new Date(parsed.data.activeFrom),
        activeUntil: new Date(parsed.data.activeUntil),
        categories: { connect: { id: allCategoryId } },
        createdById: req.user!.id,
      },
      include: adInclude,
    });
    res.status(201).json(AdSchema.parse(toAdDTO(ad)));
  } catch (err) {
    await deleteObject(audioKey).catch(() => {});
    throw err;
  }
});

adsRoutes.patch("/:id", audioUpload, async (req: Request<{ id: string }>, res) => {
  const existing = await prisma.ad.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "ad not found" });
    return;
  }

  const parsed = UpdateAdRequestSchema.safeParse({
    title: optionalStringField(req.body.title),
    activeFrom: optionalStringField(req.body.activeFrom),
    activeUntil: optionalStringField(req.body.activeUntil),
    isActive: req.body.isActive === undefined ? undefined : req.body.isActive === "true",
  });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const data: Prisma.AdUpdateInput = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.activeFrom !== undefined) data.activeFrom = new Date(parsed.data.activeFrom);
  if (parsed.data.activeUntil !== undefined) data.activeUntil = new Date(parsed.data.activeUntil);
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  const audioFile = req.file;
  const oldAudioKey = existing.fileKey;
  let newAudioKey: string | null = null;
  if (audioFile) {
    const id3 = await extractAudioMetadata(audioFile.buffer, audioFile.mimetype);
    newAudioKey = adAudioKey(existing.id, extensionFor(audioFile.originalname, audioFile.mimetype));
    await uploadObject(newAudioKey, audioFile.buffer, audioFile.mimetype);
    data.fileKey = newAudioKey;
    data.fileMimeType = audioFile.mimetype;
    data.fileSizeBytes = audioFile.size;
    data.durationMs = id3.durationMs;
  }

  const ad = await prisma.ad.update({ where: { id: existing.id }, data, include: adInclude });
  if (newAudioKey && newAudioKey !== oldAudioKey) await deleteObject(oldAudioKey).catch(() => {});
  res.json(AdSchema.parse(toAdDTO(ad)));
});

adsRoutes.delete("/:id", async (req, res) => {
  const existing = await prisma.ad.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "ad not found" });
    return;
  }

  await prisma.ad.delete({ where: { id: existing.id } });
  await deleteObject(existing.fileKey).catch(() => {});
  res.status(204).send();
});
