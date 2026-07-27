import { prisma, type ExternalStream, type ExternalStreamStatus } from "@spectado/database";
import { logger } from "../logger.js";
import { getNowPlaying } from "../modules/nowPlaying/nowPlayingCache.js";
import { publishRelayStartCommand, publishRelayStopCommand } from "../nats/publishers.js";
import { SCHEDULER_TICK_MS } from "./constants.js";
import { isTimeTriggerDue } from "./triggerEngine.js";

/** SCHEDULED = not yet started; STOPPED = a recurring (WEEKLY/INTERVAL/PLAY_COUNT) stream
 * that already ran once and is eligible to fire again. FAILED/CANCELLED/PLAYING are excluded
 * (PLAYING is handled by evaluateExternalStreamEndings below). */
const REFIRABLE_STATUSES: ExternalStreamStatus[] = ["SCHEDULED", "STOPPED"];

async function fireExternalStream(stream: ExternalStream, now: Date): Promise<void> {
  const endAt =
    stream.endBehavior === "AT_TIME"
      ? stream.endAt
      : stream.endBehavior === "AFTER_DURATION" && stream.durationMs
        ? new Date(now.getTime() + stream.durationMs)
        : null;

  await publishRelayStartCommand({ relayId: stream.id, name: stream.name, url: stream.url, startAt: now, endAt, userId: null });

  await prisma.externalStream.update({
    where: { id: stream.id },
    data: { status: "PLAYING", startedAt: now, lastTriggeredAt: now, playsSinceLastTrigger: 0 },
  });

  logger.info({ streamId: stream.id, insertionMode: stream.insertionMode }, "external stream fired");
}

/** Checked on every scheduler tick. ASAP waits for the currently-playing item to be about
 * to finish (per the Redis-backed now-playing cache) before switching the primary source;
 * AT_TIME fires immediately, interrupting whatever's on air. */
export async function evaluateExternalStreams(now: Date): Promise<void> {
  const candidates = await prisma.externalStream.findMany({
    where: { status: { in: REFIRABLE_STATUSES } },
  });

  for (const stream of candidates) {
    if (!isTimeTriggerDue(stream, now)) continue;

    try {
      if (stream.insertionMode === "AT_TIME") {
        await fireExternalStream(stream, now);
        continue;
      }

      const nowPlaying = await getNowPlaying();
      const currentEndsAtMs =
        nowPlaying?.startedAt && nowPlaying.durationMs
          ? new Date(nowPlaying.startedAt).getTime() + nowPlaying.durationMs
          : null;
      const dueSoon = currentEndsAtMs === null || currentEndsAtMs <= now.getTime() + SCHEDULER_TICK_MS;
      if (dueSoon) {
        await fireExternalStream(stream, now);
      }
    } catch (err) {
      logger.error({ err, streamId: stream.id }, "failed to fire external stream");
    }
  }

  await evaluateExternalStreamEndings(now);
}

async function evaluateExternalStreamEndings(now: Date): Promise<void> {
  const playing = await prisma.externalStream.findMany({ where: { status: "PLAYING" } });

  for (const stream of playing) {
    const shouldForceStop =
      (stream.endBehavior === "AT_TIME" && stream.endAt !== null && now >= stream.endAt) ||
      (stream.endBehavior === "AFTER_DURATION" &&
        stream.durationMs !== null &&
        stream.startedAt !== null &&
        now.getTime() >= stream.startedAt.getTime() + stream.durationMs);

    if (!shouldForceStop) continue;

    try {
      await publishRelayStopCommand({ relayId: stream.id, userId: null });
      await prisma.externalStream.update({ where: { id: stream.id }, data: { status: "STOPPED" } });
      logger.info({ streamId: stream.id }, "external stream force-stopped");
    } catch (err) {
      logger.error({ err, streamId: stream.id }, "failed to force-stop external stream");
    }
  }
}
