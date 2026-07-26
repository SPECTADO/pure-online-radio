import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, type ScheduleTriggerType } from "@spectado/database";
import {
  CreateQueueEntryRequestSchema,
  PlaybackModeSchema,
  QueueEntrySchema,
  UpcomingTriggerSchema,
  type QueueEntryDTO,
  type UpcomingTriggerDTO,
} from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { findActiveMedia } from "../../lib/media.js";
import { UPCOMING_TRIGGER_WINDOW_MS } from "../../scheduler/constants.js";
import { computeNextOccurrence } from "../../scheduler/triggerEngine.js";
import {
  publishAdvanceCommand,
  publishJinglePlayCommand,
  publishJingleStopCommand,
  publishQueueUpdated,
  publishSetModeCommand,
} from "../../nats/publishers.js";

export const queueRoutes = Router();

queueRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

export const queueEntryInclude = {
  song: true,
  jingle: true,
  ad: true,
  scheduleRule: { select: { name: true } },
  clockWheelStep: { select: { clockWheel: { select: { name: true } } } },
} satisfies Prisma.ScheduledItemInclude;

export type QueueEntryWithIncludes = Prisma.ScheduledItemGetPayload<{ include: typeof queueEntryInclude }>;

export function toQueueEntryDTO(item: QueueEntryWithIncludes): QueueEntryDTO {
  const media = item.song ?? item.jingle ?? item.ad;
  if (!media) {
    throw new Error(`ScheduledItem ${item.id} has no song/jingle/ad attached`);
  }
  return {
    id: item.id,
    mediaKind: item.mediaKind,
    mediaId: item.songId ?? item.jingleId ?? item.adId ?? "",
    title: media.title,
    artist: item.song?.artist ?? null,
    durationMs: media.durationMs,
    scheduledFor: item.scheduledFor?.toISOString() ?? null,
    status: item.status,
    addedAt: item.createdAt.toISOString(),
    scheduleRuleName: item.scheduleRule?.name ?? null,
    clockWheelName: item.clockWheelStep?.clockWheel.name ?? null,
  };
}

// Due (scheduledFor <= now, materialized by a ScheduleRule firing) items always outrank the
// manual queue (scheduledFor: null), which outranks clock-wheel fills (clockWheelStepId set) --
// same 3-tier priority order as internal/playback/next's claimNextQueueItem -- so a manager sees
// a fired-but-not-yet-claimed block ahead of whatever's manually queued, ahead of rotation filler.
// The clock-wheel tier isn't gated on scheduledFor (see claimNextQueueItem's comment for why), so
// it's fetched as "all pending clock-wheel rows" rather than a scheduledFor-bounded query.
queueRoutes.get("/", async (_req, res) => {
  const now = new Date();
  const [due, manual, wheel] = await Promise.all([
    prisma.scheduledItem.findMany({
      where: { status: "PENDING", scheduledFor: { lte: now }, clockWheelStepId: null },
      include: queueEntryInclude,
      orderBy: [{ scheduledFor: "asc" }, { position: "asc" }],
    }),
    prisma.scheduledItem.findMany({
      where: { status: "PENDING", scheduledFor: null },
      include: queueEntryInclude,
      orderBy: { position: "asc" },
    }),
    prisma.scheduledItem.findMany({
      where: { status: "PENDING", clockWheelStepId: { not: null } },
      include: queueEntryInclude,
      orderBy: { position: "asc" },
    }),
  ]);

  const items = [...due, ...manual, ...wheel];
  res.json(items.map((item) => QueueEntrySchema.parse(toQueueEntryDTO(item))));
});

const UPCOMING_TRIGGER_TYPES: ScheduleTriggerType[] = ["ONE_TIME", "WEEKLY", "INTERVAL"];

// Not-yet-fired ScheduleRule/ExternalStream previews within the lookahead window -- distinct
// from the real, already-materialized rows GET "/" returns above. See
// packages/shared-types/src/dto/upcoming-trigger.ts and apps/api/src/scheduler/triggerEngine.ts's
// computeNextOccurrence for why PLAY_COUNT never appears here.
queueRoutes.get("/upcoming-triggers", async (_req, res) => {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + UPCOMING_TRIGGER_WINDOW_MS);

  const [rules, streams] = await Promise.all([
    prisma.scheduleRule.findMany({
      where: { isActive: true, triggerType: { in: UPCOMING_TRIGGER_TYPES } },
      include: { _count: { select: { items: true } } },
    }),
    prisma.externalStream.findMany({
      where: { status: { in: ["SCHEDULED", "STOPPED"] }, triggerType: { in: UPCOMING_TRIGGER_TYPES } },
    }),
  ]);

  const triggers: UpcomingTriggerDTO[] = [];

  for (const rule of rules) {
    const next = computeNextOccurrence(rule, now);
    if (next && next <= windowEnd) {
      triggers.push({
        kind: "SCHEDULE_RULE",
        id: rule.id,
        name: rule.name,
        expectedAt: next.toISOString(),
        insertionMode: rule.insertionMode,
        itemCount: rule._count.items,
      });
    }
  }

  for (const stream of streams) {
    const next = computeNextOccurrence(stream, now);
    if (next && next <= windowEnd) {
      triggers.push({
        kind: "EXTERNAL_STREAM",
        id: stream.id,
        name: stream.name,
        expectedAt: next.toISOString(),
        insertionMode: stream.insertionMode,
        itemCount: null,
      });
    }
  }

  triggers.sort((a, b) => a.expectedAt.localeCompare(b.expectedAt));
  res.json(triggers.map((t) => UpcomingTriggerSchema.parse(t)));
});

queueRoutes.post("/items", async (req, res) => {
  const parsed = CreateQueueEntryRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const { mediaKind, mediaId, playNext } = parsed.data;
  const media = await findActiveMedia(mediaKind, mediaId);
  if (!media) {
    res.status(404).json({ error: `${mediaKind.toLowerCase()} not found` });
    return;
  }
  if (!media.isActive) {
    res.status(400).json({ error: `${mediaKind.toLowerCase()} is not active` });
    return;
  }

  // "Play next" prepends (lowest position - 1) instead of appending
  // (highest position + 1) -- position is just a sort key, not a dense
  // index, so negative/non-contiguous values are fine.
  let position: number;
  if (playNext) {
    const { _min } = await prisma.scheduledItem.aggregate({
      where: { status: "PENDING", scheduledFor: null },
      _min: { position: true },
    });
    position = (_min.position ?? 1) - 1;
  } else {
    const { _max } = await prisma.scheduledItem.aggregate({
      where: { status: "PENDING", scheduledFor: null },
      _max: { position: true },
    });
    position = (_max.position ?? 0) + 1;
  }

  const item = await prisma.scheduledItem.create({
    data: {
      scheduledFor: null,
      position,
      mediaKind,
      songId: mediaKind === "SONG" ? mediaId : undefined,
      jingleId: mediaKind === "JINGLE" ? mediaId : undefined,
      adId: mediaKind === "AD" ? mediaId : undefined,
      status: "PENDING",
      createdById: req.user!.id,
    },
    include: queueEntryInclude,
  });

  await publishQueueUpdated("item-added");
  res.status(201).json(QueueEntrySchema.parse(toQueueEntryDTO(item)));
});

queueRoutes.delete("/items/:id", async (req, res) => {
  const existing = await prisma.scheduledItem.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.status !== "PENDING") {
    res.status(404).json({ error: "queue item not found" });
    return;
  }

  await prisma.scheduledItem.delete({ where: { id: existing.id } });
  await publishQueueUpdated("item-removed");
  res.status(204).send();
});

// A distinct top-level path (not /items/rotation) so it can't be shadowed by /items/:id --
// see schedule.routes.ts's /upcoming-before-/:id comment for the same class of bug.
// Bulk-removes every not-yet-played clock-wheel fill; the engine regenerates fresh content
// on its next tick (same "cancel, don't strand" reasoning as clockWheels.routes.ts's
// step-replace/delete handlers), so this is a real "start rotation over" action, not
// destructive in a way that leaves the queue empty for long.
queueRoutes.delete("/rotation", async (_req, res) => {
  const { count } = await prisma.scheduledItem.deleteMany({
    where: { status: "PENDING", clockWheelStepId: { not: null } },
  });
  await publishQueueUpdated("rotation-cleared");
  res.json({ removed: count });
});

const ReorderQueueRequestSchema = z.object({
  // "manual" = the manager-queued FIFO (scheduledFor: null); "rotation" = clock-wheel-filled
  // items (clockWheelStepId set) -- reordering only ever happens within one pool at a time,
  // never across tiers (due schedule-fired items are never reorderable at all), since the
  // claim priority between pools is fixed regardless of position -- see claimNextQueueItem.
  scope: z.enum(["manual", "rotation"]).default("manual"),
  orderedIds: z.array(z.string()).min(1),
});

// Body is the full new ordering (every currently-PENDING item's id in `scope`, in the
// desired order) rather than a from/to index pair -- simpler to reason
// about, atomic, and works unchanged for a future drag-and-drop UI in
// addition to today's move-up/move-down buttons.
queueRoutes.patch("/items/reorder", async (req, res) => {
  const parsed = ReorderQueueRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request body", issues: parsed.error.issues });
    return;
  }

  const { scope, orderedIds } = parsed.data;
  const where: Prisma.ScheduledItemWhereInput =
    scope === "manual"
      ? { status: "PENDING", scheduledFor: null }
      : { status: "PENDING", clockWheelStepId: { not: null } };

  const pending = await prisma.scheduledItem.findMany({ where, select: { id: true } });
  const pendingIds = new Set(pending.map((p) => p.id));

  if (orderedIds.length !== pendingIds.size || !orderedIds.every((id) => pendingIds.has(id))) {
    res.status(400).json({ error: `orderedIds must contain exactly the current pending ${scope} queue items` });
    return;
  }

  await prisma.$transaction(
    orderedIds.map((id, index) => prisma.scheduledItem.update({ where: { id }, data: { position: index + 1 } })),
  );

  await publishQueueUpdated("reordered");
  res.status(204).send();
});

// --- these publish real NATS commands + write CommandAuditLog rows, proving the
// command-publish path end-to-end even though queue resolution logic isn't built yet ---

queueRoutes.post("/skip", async (req, res, next) => {
  try {
    const command = await publishAdvanceCommand({
      requestedBy: req.user?.username ?? null,
      reason: "skip",
      userId: req.user?.id ?? null,
    });
    res.json({ ok: true, commandId: command.commandId });
  } catch (err) {
    next(err);
  }
});

queueRoutes.post("/start", async (req, res, next) => {
  try {
    const command = await publishAdvanceCommand({
      requestedBy: req.user?.username ?? null,
      reason: "manual-start",
      userId: req.user?.id ?? null,
    });
    res.json({ ok: true, commandId: command.commandId });
  } catch (err) {
    next(err);
  }
});

const SetModeRequestSchema = z.object({ mode: PlaybackModeSchema });

queueRoutes.post("/mode", async (req, res, next) => {
  const parsed = SetModeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request body", issues: parsed.error.issues });
    return;
  }

  try {
    const command = await publishSetModeCommand({
      mode: parsed.data.mode,
      userId: req.user?.id ?? null,
    });
    res.json({ ok: true, commandId: command.commandId });
  } catch (err) {
    next(err);
  }
});

// --- standalone jingle overlay: independent of the queue, ducks over whatever
// the primary bus is currently playing ---

const PlayJingleRequestSchema = z.object({ jingleId: z.string() });

queueRoutes.post("/jingle/play", async (req, res, next) => {
  const parsed = PlayJingleRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request body", issues: parsed.error.issues });
    return;
  }

  const jingle = await prisma.jingle.findUnique({ where: { id: parsed.data.jingleId } });
  if (!jingle) {
    res.status(404).json({ error: "jingle not found" });
    return;
  }
  if (!jingle.isActive) {
    res.status(400).json({ error: "jingle is not active" });
    return;
  }

  try {
    const command = await publishJinglePlayCommand({
      jingle,
      userId: req.user?.id ?? null,
    });
    res.json({ ok: true, commandId: command.commandId });
  } catch (err) {
    next(err);
  }
});

queueRoutes.post("/jingle/stop", async (req, res, next) => {
  try {
    const command = await publishJingleStopCommand({ userId: req.user?.id ?? null });
    res.json({ ok: true, commandId: command.commandId });
  } catch (err) {
    next(err);
  }
});
