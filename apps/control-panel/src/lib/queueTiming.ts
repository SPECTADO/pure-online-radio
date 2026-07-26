import type { NowPlayingDTO, QueueEntryDTO, UpcomingTriggerDTO } from "@spectado/shared-types";

/**
 * Attaches an expected epoch-ms start time to each queue item, walking
 * forward from when the currently-playing item is expected to end (or "now"
 * if nothing is live -- e.g. the queue is empty on the encoder's next
 * silence-retry) and accumulating each item's own durationMs. Approximate by
 * nature (a manual skip/start changes actual timing), but close enough for
 * "roughly when will this play" display.
 */
export function withExpectedStartTimes<T extends QueueEntryDTO>(
  nowPlaying: NowPlayingDTO | undefined,
  items: T[],
): Array<T & { expectedStartAt: number }> {
  let cursor =
    nowPlaying?.isLive && nowPlaying.startedAt && nowPlaying.durationMs
      ? new Date(nowPlaying.startedAt).getTime() + nowPlaying.durationMs
      : Date.now();

  return items.map((item) => {
    const expectedStartAt = cursor;
    cursor += item.durationMs;
    return { ...item, expectedStartAt };
  });
}

/** A row in the merged Up Next / Queue display: either a real queue entry (manual, or a
 * fired-but-not-yet-claimed schedule block -- distinguished by `entry.scheduledFor`/
 * `entry.scheduleRuleName`) or a not-yet-fired preview of an upcoming trigger. */
export type UpNextDisplayEntry =
  | { kind: "queued"; key: string; expectedAt: number; entry: QueueEntryDTO & { expectedStartAt: number } }
  | { kind: "SCHEDULE_RULE" | "EXTERNAL_STREAM"; key: string; expectedAt: number; trigger: UpcomingTriggerDTO };

/**
 * Merges the real queue (with accumulated expected start times) and the not-yet-fired trigger
 * previews into one chronologically-sorted list -- shared by the Dashboard's Up Next and the
 * Queue page so a scheduled block/external stream appears positioned at roughly the moment it'll
 * actually happen, not in a separate section. Real queue entries keep their accumulated
 * (cursor-based) time; previews use their own independently-computed `expectedAt`.
 */
export function buildUpNextList(
  nowPlaying: NowPlayingDTO | undefined,
  queueEntries: QueueEntryDTO[],
  upcomingTriggers: UpcomingTriggerDTO[],
): UpNextDisplayEntry[] {
  const queued: UpNextDisplayEntry[] = withExpectedStartTimes(nowPlaying, queueEntries).map((entry) => ({
    kind: "queued",
    key: `queued-${entry.id}`,
    expectedAt: entry.expectedStartAt,
    entry,
  }));

  const triggers: UpNextDisplayEntry[] = upcomingTriggers.map((trigger) => ({
    kind: trigger.kind,
    key: `trigger-${trigger.kind}-${trigger.id}`,
    expectedAt: new Date(trigger.expectedAt).getTime(),
    trigger,
  }));

  return [...queued, ...triggers].sort((a, b) => a.expectedAt - b.expectedAt);
}
