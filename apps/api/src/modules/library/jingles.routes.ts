import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { Prisma, prisma } from "@spectado/database";
import {
  CreateJingleRequestSchema,
  JingleSchema,
  UpdateJingleRequestSchema,
  type JingleDTO,
} from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { audioUpload } from "../../middleware/upload.js";
import { extractAudioMetadata } from "../../lib/audioMetadata.js";
import { parseJsonArrayField, optionalStringField } from "../../lib/multipartFields.js";
import { deleteObject, extensionFor, jingleAudioKey, uploadObject } from "../../lib/storage.js";
import { streamAudioResponse } from "../../lib/streamAudioResponse.js";
import { ensureAllCategoryId } from "./allCategory.js";

export const jinglesRoutes = Router();

jinglesRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

const jingleInclude = {
  categories: true,
  _count: { select: { playbackHistory: true } },
  playbackHistory: {
    orderBy: { startedAt: "desc" as const },
    take: 1,
    select: { startedAt: true },
  },
} satisfies Prisma.JingleInclude;

type JingleWithIncludes = Prisma.JingleGetPayload<{ include: typeof jingleInclude }>;

function toJingleDTO(jingle: JingleWithIncludes): JingleDTO {
  return {
    id: jingle.id,
    title: jingle.title,
    type: jingle.type,
    tags: jingle.tags,
    categories: jingle.categories.map((c) => ({ id: c.id, name: c.name })),
    durationMs: jingle.durationMs,
    isActive: jingle.isActive,
    lastPlayedAt: jingle.playbackHistory[0]?.startedAt.toISOString() ?? null,
    playCount: jingle._count.playbackHistory,
    createdAt: jingle.createdAt.toISOString(),
  };
}

/** Always includes the "ALL" category alongside whatever the manager picked. */
async function resolveCategoryIds(requestedIds: string[]): Promise<string[]> {
  const allCategoryId = await ensureAllCategoryId();
  return [...new Set([...requestedIds, allCategoryId])];
}

jinglesRoutes.get("/", async (_req, res) => {
  const jingles = await prisma.jingle.findMany({
    include: jingleInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json(jingles.map((jingle) => JingleSchema.parse(toJingleDTO(jingle))));
});

// For control-panel audio preview -- streamed (not a direct MinIO URL, which
// a browser can never reach) with Range pass-through so <audio> can seek.
jinglesRoutes.get("/:id/audio", async (req, res) => {
  const jingle = await prisma.jingle.findUnique({
    where: { id: req.params.id },
    select: { fileKey: true, fileMimeType: true },
  });
  if (!jingle) {
    res.status(404).json({ error: "jingle not found" });
    return;
  }
  await streamAudioResponse(req, res, jingle.fileKey, jingle.fileMimeType);
});

jinglesRoutes.get("/:id", async (req, res) => {
  const jingle = await prisma.jingle.findUnique({
    where: { id: req.params.id },
    include: jingleInclude,
  });
  if (!jingle) {
    res.status(404).json({ error: "jingle not found" });
    return;
  }
  res.json(JingleSchema.parse(toJingleDTO(jingle)));
});

jinglesRoutes.post("/", audioUpload, async (req, res) => {
  const audioFile = req.file;
  if (!audioFile) {
    res.status(400).json({ error: "an audio file ('file' field) is required" });
    return;
  }

  const parsed = CreateJingleRequestSchema.safeParse({
    title: optionalStringField(req.body.title),
    type: optionalStringField(req.body.type),
    tags: parseJsonArrayField(req.body.tags),
    categoryIds: parseJsonArrayField(req.body.categoryIds),
  });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const id3 = await extractAudioMetadata(audioFile.buffer, audioFile.mimetype);
  const fallbackTitle = audioFile.originalname.replace(/\.[^.]+$/, "");
  const title = parsed.data.title ?? id3.title ?? fallbackTitle;

  const id = randomUUID();
  const audioKey = jingleAudioKey(id, extensionFor(audioFile.originalname, audioFile.mimetype));
  await uploadObject(audioKey, audioFile.buffer, audioFile.mimetype);

  try {
    const categoryIds = await resolveCategoryIds(parsed.data.categoryIds);
    const jingle = await prisma.jingle.create({
      data: {
        id,
        title,
        type: parsed.data.type,
        tags: parsed.data.tags,
        durationMs: id3.durationMs,
        fileKey: audioKey,
        fileMimeType: audioFile.mimetype,
        fileSizeBytes: audioFile.size,
        categories: { connect: categoryIds.map((categoryId) => ({ id: categoryId })) },
        createdById: req.user!.id,
      },
      include: jingleInclude,
    });
    res.status(201).json(JingleSchema.parse(toJingleDTO(jingle)));
  } catch (err) {
    await deleteObject(audioKey).catch(() => {});
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      res.status(400).json({ error: "one or more categoryIds do not exist" });
      return;
    }
    throw err;
  }
});

jinglesRoutes.patch("/:id", audioUpload, async (req: Request<{ id: string }>, res) => {
  const existing = await prisma.jingle.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "jingle not found" });
    return;
  }

  const parsed = UpdateJingleRequestSchema.safeParse({
    title: optionalStringField(req.body.title),
    type: optionalStringField(req.body.type),
    tags: req.body.tags === undefined ? undefined : parseJsonArrayField(req.body.tags),
    categoryIds: req.body.categoryIds === undefined ? undefined : parseJsonArrayField(req.body.categoryIds),
    isActive: req.body.isActive === undefined ? undefined : req.body.isActive === "true",
  });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const data: Prisma.JingleUpdateInput = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.type !== undefined) data.type = parsed.data.type;
  if (parsed.data.tags !== undefined) data.tags = parsed.data.tags;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
  if (parsed.data.categoryIds !== undefined) {
    const categoryIds = await resolveCategoryIds(parsed.data.categoryIds);
    data.categories = { set: categoryIds.map((categoryId) => ({ id: categoryId })) };
  }

  const audioFile = req.file;
  const oldAudioKey = existing.fileKey;
  let newAudioKey: string | null = null;
  if (audioFile) {
    const id3 = await extractAudioMetadata(audioFile.buffer, audioFile.mimetype);
    newAudioKey = jingleAudioKey(existing.id, extensionFor(audioFile.originalname, audioFile.mimetype));
    await uploadObject(newAudioKey, audioFile.buffer, audioFile.mimetype);
    data.fileKey = newAudioKey;
    data.fileMimeType = audioFile.mimetype;
    data.fileSizeBytes = audioFile.size;
    data.durationMs = id3.durationMs;
  }

  try {
    const jingle = await prisma.jingle.update({ where: { id: existing.id }, data, include: jingleInclude });
    if (newAudioKey && newAudioKey !== oldAudioKey) await deleteObject(oldAudioKey).catch(() => {});
    res.json(JingleSchema.parse(toJingleDTO(jingle)));
  } catch (err) {
    if (newAudioKey) await deleteObject(newAudioKey).catch(() => {});
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      res.status(400).json({ error: "one or more categoryIds do not exist" });
      return;
    }
    throw err;
  }
});

jinglesRoutes.delete("/:id", async (req, res) => {
  const existing = await prisma.jingle.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "jingle not found" });
    return;
  }

  await prisma.jingle.delete({ where: { id: existing.id } });
  await deleteObject(existing.fileKey).catch(() => {});
  res.status(204).send();
});
