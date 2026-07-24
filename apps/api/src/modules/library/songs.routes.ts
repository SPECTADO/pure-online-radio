import { Router } from "express";
import { prisma, type Prisma } from "@spectado/database";
import { SongSchema, type SongDTO } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const songsRoutes = Router();

songsRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

const songInclude = {
  category: true,
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
    // TODO: presigned MinIO GET URL for coverArtKey once the S3 client integration
    // lands alongside the POST/PATCH upload handlers below.
    coverArtUrl: null,
    category: song.category ? { id: song.category.id, name: song.category.name } : null,
    tags: song.tags,
    isActive: song.isActive,
    lastPlayedAt: song.playbackHistory[0]?.startedAt.toISOString() ?? null,
    playCount: song._count.playbackHistory,
    createdAt: song.createdAt.toISOString(),
  };
}

songsRoutes.get("/", async (_req, res) => {
  const songs = await prisma.song.findMany({
    include: songInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json(songs.map((song) => SongSchema.parse(toSongDTO(song))));
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

songsRoutes.post("/", (_req, res) => {
  // TODO: accept multipart/form-data, stream the audio file straight through to
  // MinIO via @aws-sdk/client-s3 (PutObject to `songs/{id}/original.{ext}`),
  // extract duration/tags/embedded cover art with `music-metadata`, then create
  // the Song row with the resulting fileKey/durationMs/coverArtKey.
  res.status(501).json({
    error: "not implemented",
    todo: "multipart upload to MinIO + music-metadata tag extraction",
  });
});

songsRoutes.patch("/:id", (_req, res) => {
  res.status(501).json({
    error: "not implemented",
    todo: "update song metadata, optionally replacing the audio file via MinIO",
  });
});

songsRoutes.delete("/:id", (_req, res) => {
  res.status(501).json({
    error: "not implemented",
    todo: "soft-delete (isActive=false) or hard-delete + remove the MinIO object",
  });
});
