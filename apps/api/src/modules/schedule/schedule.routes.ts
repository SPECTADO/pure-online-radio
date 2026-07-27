import { Router } from "express";
import { Prisma, prisma } from "@spectado/database";
import { QueueEntrySchema, ScheduleRuleSchema, UpsertScheduleRuleRequestSchema } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { findActiveMedia } from "../../lib/media.js";
import { logger } from "../../logger.js";
import { triggerFromPrisma, triggerToPrismaData } from "../../lib/scheduleTrigger.js";
import { queueEntryInclude, toQueueEntryDTO } from "../queue/queue.routes.js";

export const scheduleRoutes = Router();

scheduleRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

const ruleInclude = {
  items: { orderBy: { order: "asc" }, include: { song: true, jingle: true, ad: true, voiceTrack: true } },
} satisfies Prisma.ScheduleRuleInclude;

type RuleWithItems = Prisma.ScheduleRuleGetPayload<{ include: typeof ruleInclude }>;

/** Its underlying Song/Jingle/Ad/VoiceTrack can be deleted out from under a still-referenced
 * ScheduleRuleItem (the FK is ON DELETE SET NULL, not a delete guard) -- an item like that is
 * dropped from the rule's DTO (with a warning) rather than throwing and 500ing the whole list;
 * the manager can still see/edit/delete the rule and just re-pick a replacement item. */
function toScheduleRuleDTO(rule: RuleWithItems) {
  const items = [];
  for (const item of rule.items) {
    const media = item.song ?? item.jingle ?? item.ad ?? item.voiceTrack;
    if (!media) {
      logger.warn(
        { ruleId: rule.id, itemId: item.id },
        "ScheduleRuleItem has no song/jingle/ad/voiceTrack attached (its media was likely deleted) -- omitting from response",
      );
      continue;
    }
    items.push({
      id: item.id,
      order: item.order,
      mediaKind: item.mediaKind,
      mediaId: item.songId ?? item.jingleId ?? item.adId ?? item.voiceTrackId ?? "",
      title: media.title,
      artist: item.song?.artist ?? null,
      durationMs: media.durationMs,
    });
  }

  return {
    id: rule.id,
    name: rule.name,
    isActive: rule.isActive,
    lastTriggeredAt: rule.lastTriggeredAt?.toISOString() ?? null,
    items,
    ...triggerFromPrisma(rule),
  };
}

// Registered before "/:id" so it isn't shadowed as an id lookup.
scheduleRoutes.get("/upcoming", async (_req, res) => {
  const items = await prisma.scheduledItem.findMany({
    where: { status: "PENDING", scheduledFor: { not: null }, scheduleRuleId: { not: null } },
    include: queueEntryInclude,
    orderBy: [{ scheduledFor: "asc" }, { position: "asc" }],
    take: 50,
  });
  res.json(items.map((item) => QueueEntrySchema.parse(toQueueEntryDTO(item))));
});

scheduleRoutes.get("/", async (_req, res) => {
  const rules = await prisma.scheduleRule.findMany({ include: ruleInclude, orderBy: { createdAt: "desc" } });
  res.json(rules.map((rule) => ScheduleRuleSchema.parse(toScheduleRuleDTO(rule))));
});

scheduleRoutes.get("/:id", async (req, res) => {
  const rule = await prisma.scheduleRule.findUnique({ where: { id: req.params.id }, include: ruleInclude });
  if (!rule) {
    res.status(404).json({ error: "schedule rule not found" });
    return;
  }
  res.json(ScheduleRuleSchema.parse(toScheduleRuleDTO(rule)));
});

/** Validates every item's media exists and is active; returns the first validation error
 * response (already sent) or null if everything checked out. */
async function validateItems(
  items: { mediaKind: "SONG" | "JINGLE" | "AD" | "VOICE_TRACK"; mediaId: string }[],
  res: import("express").Response,
): Promise<boolean> {
  for (const item of items) {
    const media = await findActiveMedia(item.mediaKind, item.mediaId);
    if (!media) {
      res.status(404).json({ error: `${item.mediaKind.toLowerCase()} not found: ${item.mediaId}` });
      return false;
    }
    if (!media.isActive) {
      res.status(400).json({ error: `${item.mediaKind.toLowerCase()} is not active: ${item.mediaId}` });
      return false;
    }
  }
  return true;
}

scheduleRoutes.post("/", async (req, res) => {
  const parsed = UpsertScheduleRuleRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const { name, isActive, items, ...trigger } = parsed.data;
  if (!(await validateItems(items, res))) return;

  const rule = await prisma.scheduleRule.create({
    data: {
      name,
      isActive,
      ...triggerToPrismaData(trigger),
      createdById: req.user!.id,
      items: {
        create: items.map((item, index) => ({
          order: index,
          mediaKind: item.mediaKind,
          songId: item.mediaKind === "SONG" ? item.mediaId : undefined,
          jingleId: item.mediaKind === "JINGLE" ? item.mediaId : undefined,
          adId: item.mediaKind === "AD" ? item.mediaId : undefined,
          voiceTrackId: item.mediaKind === "VOICE_TRACK" ? item.mediaId : undefined,
        })),
      },
    },
    include: ruleInclude,
  });

  res.status(201).json(ScheduleRuleSchema.parse(toScheduleRuleDTO(rule)));
});

scheduleRoutes.patch("/:id", async (req, res) => {
  const existing = await prisma.scheduleRule.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "schedule rule not found" });
    return;
  }

  const parsed = UpsertScheduleRuleRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const { name, isActive, items, ...trigger } = parsed.data;
  if (!(await validateItems(items, res))) return;

  const rule = await prisma.$transaction(async (tx) => {
    await tx.scheduleRuleItem.deleteMany({ where: { scheduleRuleId: existing.id } });
    return tx.scheduleRule.update({
      where: { id: existing.id },
      data: {
        name,
        isActive,
        ...triggerToPrismaData(trigger),
        items: {
          create: items.map((item, index) => ({
            order: index,
            mediaKind: item.mediaKind,
            songId: item.mediaKind === "SONG" ? item.mediaId : undefined,
            jingleId: item.mediaKind === "JINGLE" ? item.mediaId : undefined,
            adId: item.mediaKind === "AD" ? item.mediaId : undefined,
            voiceTrackId: item.mediaKind === "VOICE_TRACK" ? item.mediaId : undefined,
          })),
        },
      },
      include: ruleInclude,
    });
  });

  res.json(ScheduleRuleSchema.parse(toScheduleRuleDTO(rule)));
});

scheduleRoutes.delete("/:id", async (req, res) => {
  const existing = await prisma.scheduleRule.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "schedule rule not found" });
    return;
  }

  await prisma.scheduleRule.delete({ where: { id: existing.id } });
  res.status(204).send();
});
