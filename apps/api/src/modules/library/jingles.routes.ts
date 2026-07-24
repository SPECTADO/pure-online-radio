import { Router } from "express";
import { prisma, type Prisma } from "@spectado/database";
import { JingleSchema, type JingleDTO } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const jinglesRoutes = Router();

jinglesRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

const jingleInclude = {
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
    durationMs: jingle.durationMs,
    isActive: jingle.isActive,
    lastPlayedAt: jingle.playbackHistory[0]?.startedAt.toISOString() ?? null,
    playCount: jingle._count.playbackHistory,
    createdAt: jingle.createdAt.toISOString(),
  };
}

jinglesRoutes.get("/", async (_req, res) => {
  const jingles = await prisma.jingle.findMany({
    include: jingleInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json(jingles.map((jingle) => JingleSchema.parse(toJingleDTO(jingle))));
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

jinglesRoutes.post("/", (_req, res) => {
  // TODO: accept multipart/form-data, stream the audio file to MinIO via
  // @aws-sdk/client-s3, extract duration/tags with `music-metadata`, then
  // create the Jingle row with the resulting fileKey/durationMs.
  res.status(501).json({
    error: "not implemented",
    todo: "multipart upload to MinIO + music-metadata tag extraction",
  });
});

jinglesRoutes.patch("/:id", (_req, res) => {
  res.status(501).json({
    error: "not implemented",
    todo: "update jingle metadata, optionally replacing the audio file via MinIO",
  });
});

jinglesRoutes.delete("/:id", (_req, res) => {
  res.status(501).json({
    error: "not implemented",
    todo: "soft-delete (isActive=false) or hard-delete + remove the MinIO object",
  });
});
