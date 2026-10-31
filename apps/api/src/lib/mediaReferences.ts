import { prisma, type Prisma } from "@spectado/database";

type MediaFkField = "songId" | "jingleId" | "adId";

function mediaIn(field: MediaFkField, ids: string[]) {
  return { [field]: { in: ids } } as Partial<Record<MediaFkField, { in: string[] }>>;
}

/**
 * ScheduledItem/ScheduleRuleItem reference Song/Jingle/Ad with ON DELETE SET NULL, not a delete
 * guard -- deleting still-referenced media would leave a media-less row behind (a poison queue
 * head / a rule that re-materializes one on every firing). Same idea as the VoiceTrack delete
 * guard in voiceTracks.routes.ts, except PENDING clock-wheel rotation filler is NOT blocking:
 * the fill engine plans ~4h of random songs ahead, so nearly every song would be undeletable --
 * those rows are dropped instead (see deletePendingRotationItems) and the engine refills the gap.
 *
 * Returns the first blocking reference (the offending media id + a human-readable reason), or
 * null when every id is safe to delete.
 */
export async function findBlockingMediaReference(
  field: MediaFkField,
  ids: string[],
): Promise<{ mediaId: string; reason: string } | null> {
  if (ids.length === 0) return null;
  const [ruleItem, scheduledItem] = await Promise.all([
    prisma.scheduleRuleItem.findFirst({
      where: mediaIn(field, ids),
      select: { songId: true, jingleId: true, adId: true, scheduleRule: { select: { name: true } } },
    }),
    prisma.scheduledItem.findFirst({
      where: { ...mediaIn(field, ids), status: "PENDING", clockWheelStepId: null },
      select: { songId: true, jingleId: true, adId: true },
    }),
  ]);
  if (ruleItem) {
    return {
      mediaId: ruleItem[field] ?? "",
      reason: `still used by schedule rule "${ruleItem.scheduleRule.name}" -- remove it from that rule first`,
    };
  }
  if (scheduledItem) {
    return { mediaId: scheduledItem[field] ?? "", reason: "still pending in the queue -- remove it first" };
  }
  return null;
}

/** Drops PENDING clock-wheel rotation rows for the given media (run in the same transaction as
 * the media delete) -- see findBlockingMediaReference for why these don't block the delete. */
export function deletePendingRotationItems(tx: Prisma.TransactionClient, field: MediaFkField, ids: string[]) {
  return tx.scheduledItem.deleteMany({
    where: { ...mediaIn(field, ids), status: "PENDING", clockWheelStepId: { not: null } },
  });
}
