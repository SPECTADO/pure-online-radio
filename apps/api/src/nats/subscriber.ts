import { prisma } from "@spectado/database";
import {
  HeartbeatStatusSchema,
  LiveEndedStatusSchema,
  NATS_SUBJECTS,
  NATS_WILDCARDS,
  NowPlayingStatusSchema,
  RelayEndedStatusSchema,
} from "@spectado/shared-types";
import { logger } from "../logger.js";
import { setNowPlaying } from "../modules/nowPlaying/nowPlayingCache.js";
import { setLatestHeartbeat } from "../modules/status/heartbeatCache.js";
import { clearLiveMicSession, reconcileLiveMicWithHeartbeat } from "../modules/liveMic/liveMicSessionState.js";
import { subscribeRaw } from "./client.js";

/**
 * Boots the single encoder-status subscriber (radio.encoder.status.>). This
 * is the bridge from NATS into Redis that GET /public/now-playing reads from.
 *
 * TODO (future pass): on nowPlaying messages, also close out the previous
 * PlaybackHistoryEntry row (set endedAt/durationMs) and insert the new one --
 * that durable history log is what separation-rule lookups and reporting
 * will query. Not implemented yet; Redis is currently the only now-playing
 * source of truth. heartbeat is kept in an in-memory cache (see
 * modules/status/heartbeatCache.ts) for the system status page and also
 * reconciles the live-mic session guard; liveEnded clears that guard too. The
 * remaining status subjects (jingle started|ended, live started, error,
 * commandAck) are only logged for now.
 */
export function startEncoderStatusSubscriber(): void {
  subscribeRaw(NATS_WILDCARDS.encoderStatus, async (subject, data) => {
    if (subject === NATS_SUBJECTS.encoderStatus.nowPlaying) {
      const parsed = NowPlayingStatusSchema.safeParse(data);
      if (!parsed.success) {
        logger.warn({ subject, issues: parsed.error.issues }, "[nats] invalid nowPlaying status payload");
        return;
      }
      await setNowPlaying(parsed.data);
      return;
    }

    if (subject === NATS_SUBJECTS.encoderStatus.heartbeat) {
      const parsed = HeartbeatStatusSchema.safeParse(data);
      if (!parsed.success) {
        logger.warn({ subject, issues: parsed.error.issues }, "[nats] invalid heartbeat status payload");
        return;
      }
      setLatestHeartbeat(parsed.data);
      reconcileLiveMicWithHeartbeat(parsed.data.activeSlots.mic);
      return;
    }

    // ExternalStream.endBehavior = NATURAL relies on this (rather than the scheduler
    // ticker) to know when a PLAYING relay actually stopped -- see
    // apps/api/src/scheduler/externalStreamScheduler.ts.
    if (subject === NATS_SUBJECTS.encoderStatus.relayEnded) {
      const parsed = RelayEndedStatusSchema.safeParse(data);
      if (!parsed.success) {
        logger.warn({ subject, issues: parsed.error.issues }, "[nats] invalid relayEnded status payload");
        return;
      }
      // A failed connect is terminal only for a ONE_TIME stream -- a recurring one goes back to
      // STOPPED so its next occurrence still fires (one bad upstream week must not kill a weekly
      // relay for good; FAILED is never re-evaluated by the scheduler).
      const stream = await prisma.externalStream.findUnique({
        where: { id: parsed.data.relayId },
        select: { triggerType: true },
      });
      const failedTerminally = parsed.data.reason === "failed" && stream?.triggerType === "ONE_TIME";
      if (parsed.data.reason === "failed") {
        logger.warn({ relayId: parsed.data.relayId, failedTerminally }, "[nats] external stream relay failed");
      }
      await prisma.externalStream.updateMany({
        where: { id: parsed.data.relayId, status: "PLAYING" },
        data: { status: failedTerminally ? "FAILED" : "STOPPED" },
      });
      return;
    }

    // The encoder ends a live-mic session on its own whenever the browser's socket drops (or
    // never connects) -- the api's one-broadcast-at-a-time guard has to follow, or every later
    // "go on air" 409s. See modules/liveMic/liveMicSessionState.ts.
    if (subject === NATS_SUBJECTS.encoderStatus.liveEnded) {
      const parsed = LiveEndedStatusSchema.safeParse(data);
      if (!parsed.success) {
        logger.warn({ subject, issues: parsed.error.issues }, "[nats] invalid liveEnded status payload");
        return;
      }
      clearLiveMicSession(parsed.data.sessionId, "encoder reported live mic ended");
      return;
    }

    logger.info({ subject }, "[nats] encoder status received");
  });
}
