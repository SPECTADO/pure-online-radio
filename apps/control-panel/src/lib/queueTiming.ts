import type { NowPlayingDTO, QueueEntryDTO } from "@spectado/shared-types";

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
