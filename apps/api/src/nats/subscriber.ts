import { HeartbeatStatusSchema, NATS_SUBJECTS, NATS_WILDCARDS, NowPlayingStatusSchema } from "@spectado/shared-types";
import { logger } from "../logger.js";
import { setNowPlaying } from "../modules/nowPlaying/nowPlayingCache.js";
import { setLatestHeartbeat } from "../modules/status/heartbeatCache.js";
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
 * modules/status/heartbeatCache.ts) for the system status page; the
 * remaining status subjects (jingle/live/relay started|ended, error,
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
      return;
    }

    logger.info({ subject }, "[nats] encoder status received");
  });
}
