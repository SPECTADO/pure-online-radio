import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { Prisma, prisma } from "@spectado/database";
import {
  ALL_CATEGORY_NAME,
  ApplyMetadataRequestSchema,
  BatchCategoryRequestSchema,
  BatchDeleteRequestSchema,
  BatchResultSchema,
  CreateSongRequestSchema,
  MetadataSearchQuerySchema,
  MetadataSearchResultSchema,
  SongSchema,
  UpdateSongRequestSchema,
  type SongDTO,
} from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { songUpload } from "../../middleware/upload.js";
import { extractAudioMetadata } from "../../lib/audioMetadata.js";
import { parseJsonArrayField, optionalStringField } from "../../lib/multipartFields.js";
import {
  deleteObject,
  extensionFor,
  getObjectStream,
  songAudioKey,
  songCoverArtKey,
  uploadObject,
} from "../../lib/storage.js";
import { streamAudioResponse } from "../../lib/streamAudioResponse.js";
import { ensureAllCategoryId } from "./allCategory.js";
import { fetchCoverArtImage, searchSongMetadata } from "./metadataProviders/musicBrainzProvider.js";

export const songsRoutes = Router();

songsRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

const songInclude = {
  categories: true,
  _count: { select: { playbackHistory: true } },
  playbackHistory: {
    orderBy: { startedAt: "desc" as const },
    take: 1,
    select: { startedAt: true },
  },
} satisfies Prisma.SongInclude;

type SongWithIncludes = Prisma.SongGetPayload<{ include: typeof songInclude }>;

function toSongDTO(song: SongWithIncludes): SongDTO {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    durationMs: song.durationMs,
    // Relative to the API root -- streamed by the /:id/cover-art route below,
    // never a direct MinIO URL (MinIO has no published host port; a browser
    // could never reach `minio:9000` even with a valid presigned signature).
    coverArtUrl: song.coverArtKey ? `/library/songs/${song.id}/cover-art` : null,
    categories: song.categories.map((c) => ({ id: c.id, name: c.name })),
    tags: song.tags,
    isActive: song.isActive,
    lastPlayedAt: song.playbackHistory[0]?.startedAt.toISOString() ?? null,
    playCount: song._count.playbackHistory,
    createdAt: song.createdAt.toISOString(),
  };
}

/** Always includes the "ALL" category alongside whatever the manager picked. */
async function resolveCategoryIds(requestedIds: string[]): Promise<string[]> {
  const allCategoryId = await ensureAllCategoryId();
  return [...new Set([...requestedIds, allCategoryId])];
}

songsRoutes.post("/batch-delete", async (req, res) => {
  const parsed = BatchDeleteRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const songs = await prisma.song.findMany({
    where: { id: { in: parsed.data.ids } },
    select: { id: true, fileKey: true, coverArtKey: true },
  });

  await prisma.song.deleteMany({ where: { id: { in: songs.map((s) => s.id) } } });
  for (const song of songs) {
    await deleteObject(song.fileKey).catch(() => {});
    if (song.coverArtKey) await deleteObject(song.coverArtKey).catch(() => {});
  }

  res.json(BatchResultSchema.parse({ count: songs.length }));
});

songsRoutes.post("/batch-category", async (req, res) => {
  const parsed = BatchCategoryRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  if (parsed.data.action === "remove" && parsed.data.categoryId === (await ensureAllCategoryId())) {
    res.status(400).json({ error: `the "${ALL_CATEGORY_NAME}" category cannot be removed` });
    return;
  }

  const data: Prisma.SongUpdateInput = {
    categories:
      parsed.data.action === "add"
        ? { connect: { id: parsed.data.categoryId } }
        : { disconnect: { id: parsed.data.categoryId } },
  };

  let count = 0;
  for (const id of parsed.data.ids) {
    try {
      await prisma.song.update({ where: { id }, data });
      count++;
    } catch (err) {
      // Missing song or bad categoryId -- skip it and keep applying to the rest.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") continue;
      throw err;
    }
  }

  res.json(BatchResultSchema.parse({ count }));
});

// Metadata search must be registered before "/:id" so "metadata-search" isn't
// swallowed as a song id.
songsRoutes.get("/metadata-search", async (req, res) => {
  const parsed = MetadataSearchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid query", details: parsed.error.issues });
    return;
  }
  const results = await searchSongMetadata(parsed.data);
  res.json(results.map((r) => MetadataSearchResultSchema.parse(r)));
});

songsRoutes.get("/", async (_req, res) => {
  const songs = await prisma.song.findMany({
    include: songInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json(songs.map((song) => SongSchema.parse(toSongDTO(song))));
});

songsRoutes.get("/:id/cover-art", async (req, res) => {
  const song = await prisma.song.findUnique({
    where: { id: req.params.id },
    select: { coverArtKey: true },
  });
  if (!song?.coverArtKey) {
    res.status(404).json({ error: "no cover art for this song" });
    return;
  }

  const { body, contentType } = await getObjectStream(song.coverArtKey);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, max-age=300");
  body.pipe(res);
});

// For control-panel audio preview -- same never-a-direct-MinIO-URL reasoning
// as cover-art above, plus Range pass-through so the <audio> element can seek.
songsRoutes.get("/:id/audio", async (req, res) => {
  const song = await prisma.song.findUnique({
    where: { id: req.params.id },
    select: { fileKey: true, fileMimeType: true },
  });
  if (!song) {
    res.status(404).json({ error: "song not found" });
    return;
  }
  await streamAudioResponse(req, res, song.fileKey, song.fileMimeType);
});

songsRoutes.get("/:id", async (req, res) => {
  const song = await prisma.song.findUnique({
    where: { id: req.params.id },
    include: songInclude,
  });
  if (!song) {
    res.status(404).json({ error: "song not found" });
    return;
  }
  res.json(SongSchema.parse(toSongDTO(song)));
});

songsRoutes.post("/", songUpload, async (req, res) => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const audioFile = files?.file?.[0];
  if (!audioFile) {
    res.status(400).json({ error: "an audio file ('file' field) is required" });
    return;
  }

  const parsed = CreateSongRequestSchema.safeParse({
    title: optionalStringField(req.body.title),
    artist: optionalStringField(req.body.artist),
    album: optionalStringField(req.body.album),
    categoryIds: parseJsonArrayField(req.body.categoryIds),
    tags: parseJsonArrayField(req.body.tags),
  });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const id3 = await extractAudioMetadata(audioFile.buffer, audioFile.mimetype);
  const fallbackTitle = audioFile.originalname.replace(/\.[^.]+$/, "");
  const title = parsed.data.title ?? id3.title ?? fallbackTitle;
  const artist = parsed.data.artist ?? id3.artist ?? "Unknown Artist";
  const album = parsed.data.album ?? id3.album ?? null;

  const id = randomUUID();
  const audioKey = songAudioKey(id, extensionFor(audioFile.originalname, audioFile.mimetype));

  const coverArtFile = files?.coverArt?.[0];
  let coverArtKey: string | null = null;
  if (coverArtFile) {
    coverArtKey = songCoverArtKey(id, extensionFor(coverArtFile.originalname, coverArtFile.mimetype));
  } else if (id3.picture) {
    coverArtKey = songCoverArtKey(id, extensionFor("", id3.picture.mimeType));
  }

  await uploadObject(audioKey, audioFile.buffer, audioFile.mimetype);
  if (coverArtFile) {
    await uploadObject(coverArtKey!, coverArtFile.buffer, coverArtFile.mimetype);
  } else if (id3.picture) {
    await uploadObject(coverArtKey!, id3.picture.data, id3.picture.mimeType);
  }

  try {
    const categoryIds = await resolveCategoryIds(parsed.data.categoryIds);
    const song = await prisma.song.create({
      data: {
        id,
        title,
        artist,
        album,
        durationMs: id3.durationMs,
        fileKey: audioKey,
        fileMimeType: audioFile.mimetype,
        fileSizeBytes: audioFile.size,
        coverArtKey,
        tags: parsed.data.tags,
        categories: { connect: categoryIds.map((categoryId) => ({ id: categoryId })) },
        createdById: req.user!.id,
      },
      include: songInclude,
    });
    res.status(201).json(SongSchema.parse(toSongDTO(song)));
  } catch (err) {
    // Roll back the objects we just wrote so a rejected create (e.g. an
    // unknown categoryId) doesn't leave orphaned files in MinIO.
    await deleteObject(audioKey).catch(() => {});
    if (coverArtKey) await deleteObject(coverArtKey).catch(() => {});
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      res.status(400).json({ error: "one or more categoryIds do not exist" });
      return;
    }
    throw err;
  }
});

songsRoutes.patch("/:id", songUpload, async (req: Request<{ id: string }>, res) => {
  const existing = await prisma.song.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "song not found" });
    return;
  }

  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const parsed = UpdateSongRequestSchema.safeParse({
    title: optionalStringField(req.body.title),
    artist: optionalStringField(req.body.artist),
    album: req.body.album === "" ? null : optionalStringField(req.body.album),
    categoryIds: req.body.categoryIds === undefined ? undefined : parseJsonArrayField(req.body.categoryIds),
    tags: req.body.tags === undefined ? undefined : parseJsonArrayField(req.body.tags),
    isActive: req.body.isActive === undefined ? undefined : req.body.isActive === "true",
    removeCoverArt: req.body.removeCoverArt === "true",
  });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const data: Prisma.SongUpdateInput = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.artist !== undefined) data.artist = parsed.data.artist;
  if (parsed.data.album !== undefined) data.album = parsed.data.album;
  if (parsed.data.tags !== undefined) data.tags = parsed.data.tags;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
  if (parsed.data.categoryIds !== undefined) {
    const categoryIds = await resolveCategoryIds(parsed.data.categoryIds);
    data.categories = { set: categoryIds.map((categoryId) => ({ id: categoryId })) };
  }

  const audioFile = files?.file?.[0];
  const oldAudioKey = existing.fileKey;
  let newAudioKey: string | null = null;
  if (audioFile) {
    const id3 = await extractAudioMetadata(audioFile.buffer, audioFile.mimetype);
    newAudioKey = songAudioKey(existing.id, extensionFor(audioFile.originalname, audioFile.mimetype));
    await uploadObject(newAudioKey, audioFile.buffer, audioFile.mimetype);
    data.fileKey = newAudioKey;
    data.fileMimeType = audioFile.mimetype;
    data.fileSizeBytes = audioFile.size;
    data.durationMs = id3.durationMs;
  }

  const coverArtFile = files?.coverArt?.[0];
  const oldCoverArtKey = existing.coverArtKey;
  let newCoverArtKey: string | null = null;
  if (coverArtFile) {
    newCoverArtKey = songCoverArtKey(
      existing.id,
      extensionFor(coverArtFile.originalname, coverArtFile.mimetype),
    );
    await uploadObject(newCoverArtKey, coverArtFile.buffer, coverArtFile.mimetype);
    data.coverArtKey = newCoverArtKey;
  } else if (parsed.data.removeCoverArt) {
    data.coverArtKey = null;
  }

  try {
    const song = await prisma.song.update({ where: { id: existing.id }, data, include: songInclude });
    if (newAudioKey && newAudioKey !== oldAudioKey) await deleteObject(oldAudioKey).catch(() => {});
    if ((newCoverArtKey || parsed.data.removeCoverArt) && oldCoverArtKey && oldCoverArtKey !== newCoverArtKey) {
      await deleteObject(oldCoverArtKey).catch(() => {});
    }
    res.json(SongSchema.parse(toSongDTO(song)));
  } catch (err) {
    if (newAudioKey) await deleteObject(newAudioKey).catch(() => {});
    if (newCoverArtKey) await deleteObject(newCoverArtKey).catch(() => {});
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      res.status(400).json({ error: "one or more categoryIds do not exist" });
      return;
    }
    throw err;
  }
});

songsRoutes.post("/:id/apply-metadata", async (req, res) => {
  const existing = await prisma.song.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "song not found" });
    return;
  }

  const parsed = ApplyMetadataRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const data: Prisma.SongUpdateInput = {
    title: parsed.data.title,
    artist: parsed.data.artist ?? existing.artist,
    album: parsed.data.album ?? existing.album,
  };

  let newCoverArtKey: string | null = null;
  if (parsed.data.coverArtUrl) {
    const image = await fetchCoverArtImage(parsed.data.coverArtUrl);
    if (image) {
      newCoverArtKey = songCoverArtKey(existing.id, extensionFor("", image.mimeType));
      await uploadObject(newCoverArtKey, image.data, image.mimeType);
      data.coverArtKey = newCoverArtKey;
    }
  }

  const song = await prisma.song.update({ where: { id: existing.id }, data, include: songInclude });
  if (newCoverArtKey && existing.coverArtKey && existing.coverArtKey !== newCoverArtKey) {
    await deleteObject(existing.coverArtKey).catch(() => {});
  }
  res.json(SongSchema.parse(toSongDTO(song)));
});

songsRoutes.delete("/:id", async (req, res) => {
  const existing = await prisma.song.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "song not found" });
    return;
  }

  await prisma.song.delete({ where: { id: existing.id } });
  await deleteObject(existing.fileKey).catch(() => {});
  if (existing.coverArtKey) await deleteObject(existing.coverArtKey).catch(() => {});
  res.status(204).send();
});
