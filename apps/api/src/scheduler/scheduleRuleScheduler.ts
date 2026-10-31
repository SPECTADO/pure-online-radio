import { Prisma, prisma, type ScheduleTriggerType } from "@spectado/database";
import { logger } from "../logger.js";
import { publishAdvanceCommand } from "../nats/publishers.js";
import { isTimeTriggerDue } from "./triggerEngine.js";

const ruleWithItemsInclude = {
  items: { orderBy: { order: "asc" } },
} satisfies Prisma.ScheduleRuleInclude;

type RuleWithItems = Prisma.ScheduleRuleGetPayload<{ include: typeof ruleWithItemsInclude }>;

const TIME_TRIGGERED_TYPES: ScheduleTriggerType[] = ["ONE_TIME", "WEEKLY", "INTERVAL"];

/** Advances a rule's trigger bookkeeping (lastTriggeredAt, counter reset, one-time
 * deactivation) without materializing anything -- used when a fire is skipped outright. */
async function advanceRuleWithoutFiring(rule: RuleWithItems, now: Date): Promise<void> {
  await prisma.scheduleRule.update({
    where: { id: rule.id },
    data: {
      lastTriggeredAt: now,
      playsSinceLastTrigger: 0,
      isActive: rule.triggerType === "ONE_TIME" ? false : rule.isActive,
    },
  });
}

/** Materializes one ScheduledItem per ScheduleRuleItem (in order), then -- for AT_TIME
 * insertion -- forces an immediate advance so the encoder pulls it right away instead of
 * waiting for the current item to finish. Reuses the exact same claim/advance machinery
 * the manual queue already relies on (see internal/playback/next).
 *
 * If the *previous* firing's items are still sitting PENDING (unclaimed -- e.g. a recurring
 * INTERVAL rule outpacing actual playback), this occurrence is skipped rather than piling up
 * a second batch behind the first: the rule's bookkeeping still advances (so it doesn't retry
 * every tick and doesn't fall permanently behind either), it just doesn't materialize anything
 * this time. ExternalStream doesn't need the equivalent check -- its own status machine
 * (only SCHEDULED/STOPPED rows are re-evaluated, never PLAYING) already prevents overlap. */
async function fireScheduleRule(rule: RuleWithItems, now: Date): Promise<void> {
  const stillPending = await prisma.scheduledItem.findFirst({
    where: { scheduleRuleId: rule.id, status: "PENDING" },
    select: { id: true },
  });
  if (stillPending) {
    logger.warn(
      { ruleId: rule.id, ruleName: rule.name },
      "schedule rule due again before its previous occurrence was played -- skipping this occurrence",
    );
    await advanceRuleWithoutFiring(rule, now);
    return;
  }

  // A ScheduleRuleItem whose media was deleted (FK is ON DELETE SET NULL) would materialize as a
  // media-less queue row -- skip it rather than queueing a poison item on every firing.
  const items = rule.items.filter((item) => item.songId ?? item.jingleId ?? item.adId ?? item.voiceTrackId);
  if (items.length < rule.items.length) {
    logger.warn(
      { ruleId: rule.id, skipped: rule.items.length - items.length },
      "schedule rule has items with no media attached (deleted?) -- skipping them",
    );
  }
  if (items.length === 0) {
    await advanceRuleWithoutFiring(rule, now);
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const [index, item] of items.entries()) {
      await tx.scheduledItem.create({
        data: {
          scheduledFor: now,
          position: index,
          mediaKind: item.mediaKind,
          songId: item.songId,
          jingleId: item.jingleId,
          adId: item.adId,
          voiceTrackId: item.voiceTrackId,
          status: "PENDING",
          scheduleRuleId: rule.id,
          createdById: rule.createdById,
        },
      });
    }

    await tx.scheduleRule.update({
      where: { id: rule.id },
      data: {
        lastTriggeredAt: now,
        playsSinceLastTrigger: 0,
        isActive: rule.triggerType === "ONE_TIME" ? false : rule.isActive,
      },
    });
  });

  logger.info({ ruleId: rule.id, itemCount: items.length }, "schedule rule fired");

  if (rule.insertionMode === "AT_TIME") {
    await publishAdvanceCommand({ requestedBy: null, reason: "scheduled", userId: null });
  }
}

/** Checked on every scheduler tick for the 3 time-based trigger types. */
export async function evaluateScheduleRules(now: Date): Promise<void> {
  const rules = await prisma.scheduleRule.findMany({
    where: { isActive: true, triggerType: { in: TIME_TRIGGERED_TYPES } },
    include: ruleWithItemsInclude,
  });

  for (const rule of rules) {
    if (!isTimeTriggerDue(rule, now)) continue;
    try {
      await fireScheduleRule(rule, now);
    } catch (err) {
      logger.error({ err, ruleId: rule.id }, "failed to fire schedule rule");
    }
  }
}

/** Event-driven (not tick-based): called from internal/playback/next after every claimed
 * SONG, per the user-confirmed scope ("each X songs played" counts SONG media kind only). */
export async function incrementSongPlayCountAndFire(now: Date): Promise<void> {
  const rules = await prisma.scheduleRule.findMany({
    where: { isActive: true, triggerType: "PLAY_COUNT" },
    include: ruleWithItemsInclude,
  });

  for (const rule of rules) {
    const playsSinceLastTrigger = rule.playsSinceLastTrigger + 1;
    if (rule.everyNPlays !== null && playsSinceLastTrigger >= rule.everyNPlays) {
      try {
        await fireScheduleRule(rule, now);
      } catch (err) {
        logger.error({ err, ruleId: rule.id }, "failed to fire play-count schedule rule");
      }
    } else {
      await prisma.scheduleRule.update({ where: { id: rule.id }, data: { playsSinceLastTrigger } });
    }
  }
}
