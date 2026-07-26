import { Router } from "express";
import { type ExternalStream, prisma } from "@spectado/database";
import { CreateExternalStreamRequestSchema, ExternalStreamSchema, type ExternalStreamDTO } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { triggerFromPrisma, triggerToPrismaData } from "../../lib/scheduleTrigger.js";
import { publishRelayStopCommand } from "../../nats/publishers.js";

export const externalStreamsRoutes = Router();

externalStreamsRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

function toExternalStreamDTO(stream: ExternalStream): ExternalStreamDTO {
  return {
    id: stream.id,
    name: stream.name,
    url: stream.url,
    status: stream.status,
    lastTriggeredAt: stream.lastTriggeredAt?.toISOString() ?? null,
    endBehavior: stream.endBehavior,
    endAt: stream.endAt?.toISOString() ?? null,
    durationMs: stream.durationMs,
    startedAt: stream.startedAt?.toISOString() ?? null,
    ...triggerFromPrisma(stream),
  };
}

externalStreamsRoutes.get("/", async (_req, res) => {
  const streams = await prisma.externalStream.findMany({ orderBy: { createdAt: "desc" } });
  res.json(streams.map((stream) => ExternalStreamSchema.parse(toExternalStreamDTO(stream))));
});

externalStreamsRoutes.get("/:id", async (req, res) => {
  const stream = await prisma.externalStream.findUnique({ where: { id: req.params.id } });
  if (!stream) {
    res.status(404).json({ error: "external stream not found" });
    return;
  }
  res.json(ExternalStreamSchema.parse(toExternalStreamDTO(stream)));
});

externalStreamsRoutes.post("/", async (req, res) => {
  const parsed = CreateExternalStreamRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const { name, url, endBehavior, endAt, durationMs, ...trigger } = parsed.data;

  const stream = await prisma.externalStream.create({
    data: {
      name,
      url,
      status: "SCHEDULED",
      endBehavior,
      endAt: endAt ? new Date(endAt) : null,
      durationMs: durationMs ?? null,
      ...triggerToPrismaData(trigger),
      createdById: req.user!.id,
    },
  });

  res.status(201).json(ExternalStreamSchema.parse(toExternalStreamDTO(stream)));
});

externalStreamsRoutes.patch("/:id", async (req, res) => {
  const existing = await prisma.externalStream.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "external stream not found" });
    return;
  }
  // PLAYING/FAILED/CANCELLED are all "already live or done" -- only a not-yet-started
  // (SCHEDULED) or between-occurrences (STOPPED, recurring) stream can still be edited.
  if (existing.status !== "SCHEDULED" && existing.status !== "STOPPED") {
    res.status(400).json({ error: `cannot edit a stream with status ${existing.status}` });
    return;
  }

  const parsed = CreateExternalStreamRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const { name, url, endBehavior, endAt, durationMs, ...trigger } = parsed.data;

  const stream = await prisma.externalStream.update({
    where: { id: existing.id },
    data: {
      name,
      url,
      endBehavior,
      endAt: endAt ? new Date(endAt) : null,
      durationMs: durationMs ?? null,
      ...triggerToPrismaData(trigger),
    },
  });

  res.json(ExternalStreamSchema.parse(toExternalStreamDTO(stream)));
});

externalStreamsRoutes.delete("/:id", async (req, res) => {
  const existing = await prisma.externalStream.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "external stream not found" });
    return;
  }

  if (existing.status === "PLAYING") {
    await publishRelayStopCommand({ relayId: existing.id, userId: req.user?.id ?? null });
  }
  // Soft-cancel (not a hard delete) so PlaybackHistoryEntry rows that may reference this
  // stream stay intact, same rationale as ScheduledItem's soft statuses.
  await prisma.externalStream.update({ where: { id: existing.id }, data: { status: "CANCELLED" } });
  res.status(204).send();
});
