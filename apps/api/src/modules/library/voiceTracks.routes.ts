import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { Prisma, prisma } from "@spectado/database";
import {
  CreateVoiceTrackRequestSchema,
  UpdateVoiceTrackRequestSchema,
  VoiceTrackSchema,
  type VoiceTrackDTO,
} from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { audioUpload } from "../../middleware/upload.js";
import { extractAudioMetadata } from "../../lib/audioMetadata.js";
import { optionalStringField } from "../../lib/multipartFields.js";
import { deleteObject, extensionFor, voiceTrackAudioKey, uploadObject } from "../../lib/storage.js";
import { streamAudioResponse } from "../../lib/streamAudioResponse.js";

export const voiceTracksRoutes = Router();

voiceTracksRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

function toVoiceTrackDTO(voiceTrack: {
  id: string;
  title: string;
  durationMs: number;
  isActive: boolean;
  createdAt: Date;
}): VoiceTrackDTO {
  return {
    id: voiceTrack.id,
    title: voiceTrack.title,
    durationMs: voiceTrack.durationMs,
    isActive: voiceTrack.isActive,
    createdAt: voiceTrack.createdAt.toISOString(),
  };
}

voiceTracksRoutes.get("/", async (_req, res) => {
  const voiceTracks = await prisma.voiceTrack.findMany({ orderBy: { createdAt: "desc" } });
  res.json(voiceTracks.map((voiceTrack) => VoiceTrackSchema.parse(toVoiceTrackDTO(voiceTrack))));
});

// For control-panel audio preview -- streamed (not a direct MinIO URL, which a browser can
// never reach) with Range pass-through so <audio> can seek, same as jingles/:id/audio.
voiceTracksRoutes.get("/:id/audio", async (req, res) => {
  const voiceTrack = await prisma.voiceTrack.findUnique({
    where: { id: req.params.id },
    select: { fileKey: true, fileMimeType: true },
  });
  if (!voiceTrack) {
    res.status(404).json({ error: "voice track not found" });
    return;
  }
  await streamAudioResponse(req, res, voiceTrack.fileKey, voiceTrack.fileMimeType);
});

voiceTracksRoutes.get("/:id", async (req, res) => {
  const voiceTrack = await prisma.voiceTrack.findUnique({ where: { id: req.params.id } });
  if (!voiceTrack) {
    res.status(404).json({ error: "voice track not found" });
    return;
  }
  res.json(VoiceTrackSchema.parse(toVoiceTrackDTO(voiceTrack)));
});

voiceTracksRoutes.post("/", audioUpload, async (req, res) => {
  const audioFile = req.file;
  if (!audioFile) {
    res.status(400).json({ error: "an audio file ('file' field) is required" });
    return;
  }

  const parsed = CreateVoiceTrackRequestSchema.safeParse({ title: optionalStringField(req.body.title) });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const id3 = await extractAudioMetadata(audioFile.buffer, audioFile.mimetype);
  const fallbackTitle = audioFile.originalname.replace(/\.[^.]+$/, "");
  const title = parsed.data.title ?? id3.title ?? fallbackTitle;

  const id = randomUUID();
  const audioKey = voiceTrackAudioKey(id, extensionFor(audioFile.originalname, audioFile.mimetype));
  await uploadObject(audioKey, audioFile.buffer, audioFile.mimetype);

  try {
    const voiceTrack = await prisma.voiceTrack.create({
      data: {
        id,
        title,
        durationMs: id3.durationMs,
        fileKey: audioKey,
        fileMimeType: audioFile.mimetype,
        fileSizeBytes: audioFile.size,
        createdById: req.user!.id,
      },
    });
    res.status(201).json(VoiceTrackSchema.parse(toVoiceTrackDTO(voiceTrack)));
  } catch (err) {
    await deleteObject(audioKey).catch(() => {});
    throw err;
  }
});

voiceTracksRoutes.patch("/:id", audioUpload, async (req: Request<{ id: string }>, res) => {
  const existing = await prisma.voiceTrack.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "voice track not found" });
    return;
  }

  const parsed = UpdateVoiceTrackRequestSchema.safeParse({
    title: optionalStringField(req.body.title),
    isActive: req.body.isActive === undefined ? undefined : req.body.isActive === "true",
  });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const data: Prisma.VoiceTrackUpdateInput = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  const audioFile = req.file;
  const oldAudioKey = existing.fileKey;
  let newAudioKey: string | null = null;
  if (audioFile) {
    const id3 = await extractAudioMetadata(audioFile.buffer, audioFile.mimetype);
    newAudioKey = voiceTrackAudioKey(existing.id, extensionFor(audioFile.originalname, audioFile.mimetype));
    await uploadObject(newAudioKey, audioFile.buffer, audioFile.mimetype);
    data.fileKey = newAudioKey;
    data.fileMimeType = audioFile.mimetype;
    data.fileSizeBytes = audioFile.size;
    data.durationMs = id3.durationMs;
  }

  try {
    const voiceTrack = await prisma.voiceTrack.update({ where: { id: existing.id }, data });
    if (newAudioKey && newAudioKey !== oldAudioKey) await deleteObject(oldAudioKey).catch(() => {});
    res.json(VoiceTrackSchema.parse(toVoiceTrackDTO(voiceTrack)));
  } catch (err) {
    if (newAudioKey) await deleteObject(newAudioKey).catch(() => {});
    throw err;
  }
});

voiceTracksRoutes.delete("/:id", async (req, res) => {
  const existing = await prisma.voiceTrack.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "voice track not found" });
    return;
  }

  // The FK from ScheduleRuleItem/ScheduledItem is ON DELETE SET NULL, not a delete guard --
  // without this check, deleting a still-scheduled recording leaves an orphaned item with no
  // media attached (previously crashed GET /schedule outright; that's now handled defensively
  // too, but blocking the delete here is the actually-correct fix for a still-referenced item).
  const [ruleItem, scheduledItem] = await Promise.all([
    prisma.scheduleRuleItem.findFirst({
      where: { voiceTrackId: existing.id },
      select: { scheduleRule: { select: { name: true } } },
    }),
    prisma.scheduledItem.findFirst({
      where: { voiceTrackId: existing.id, status: "PENDING" },
      select: { id: true },
    }),
  ]);
  if (ruleItem) {
    res.status(409).json({
      error: `"${existing.title}" is still used by schedule rule "${ruleItem.scheduleRule.name}" -- remove it from that rule first`,
    });
    return;
  }
  if (scheduledItem) {
    res.status(409).json({ error: `"${existing.title}" is still pending in the queue -- remove it first` });
    return;
  }

  await prisma.voiceTrack.delete({ where: { id: existing.id } });
  await deleteObject(existing.fileKey).catch(() => {});
  res.status(204).send();
});
