import { randomUUID } from "node:crypto";
import { Router } from "express";
import { Prisma, prisma } from "@spectado/database";
import {
  PlaybackDirectiveSchema,
  StreamSettingsSchema,
  resolveMixPoints,
  type PlaybackDirectiveDTO,
  type SilenceDirectiveDTO,
  type TrackDirectiveDTO,
} from "@spectado/shared-types";
import { internalOnly } from "../../middleware/internalOnly.js";
import { getPresignedGetUrl } from "../../lib/storage.js";
import { logger } from "../../logger.js";
import { incrementSongPlayCountAndFire } from "../../scheduler/scheduleRuleScheduler.js";
import { ensureStreamSettings, toStreamSettingsDTO } from "../settings/streamSettings.js";
import { ensureStationSettings } from "../settings/stationSettings.js";

export const internalRoutes = Router();

internalRoutes.use(internalOnly);

const claimInclude = {
  song: true,
  jingle: true,
  ad: true,
  voiceTrack: true,
} satisfies Prisma.ScheduledItemInclude;
type ClaimedItem = Prisma.ScheduledItemGetPayload<{ include: typeof claimInclude }>;

const TRACK_URL_BUFFER_SECONDS = 120;

const PLAYBACK_MEDIA_KIND: Record<ClaimedItem["mediaKind"], "SONG" | "JINGLE" | "AD" | "VOICE_TRACK"> = {
  SONG: "SONG",
  JINGLE: "JINGLE",
  AD: "AD",
  VOICE_TRACK: "VOICE_TRACK",
};

/**
 * Atomically pops the next item to play and marks it PLAYED. There is no
 * separate "now playing" queue-row state (ScheduledItemStatus has no
 * PLAYING) -- being handed out for playback *is* "played" as far as the
 * queue table is concerned; the encoder/NATS status stream is the source of
 * truth for what's actually audible right now. Only one caller may ever
 * invoke this (the encoder's own advance-driven fetch) since it has a real
 * side effect -- see apps/encoder/src/api/apiClient.ts.
 *
 * Claim priority: due schedule-block items (`scheduledFor <= now`,
 * materialized by a ScheduleRule firing -- see apps/api/src/scheduler/) outrank
 * the manual queue (`scheduledFor: null`), which outranks clock-wheel-filled
 * items (`clockWheelStepId` set -- see apps/api/src/scheduler/clockWheelEngine.ts).
 * The clock-wheel tier is claimed strictly FIFO by `position`, deliberately NOT
 * gated on `scheduledFor <= now`: that field is only an *estimate* used when the
 * item was planned (for wheel-matching/horizon accounting), and real playback
 * timing drifts from the estimate (skips, manual queue insertions, etc.) --
 * gating on it here would risk a real silence gap the moment actual playback
 * runs ahead of the plan.
 */
async function claimNextQueueItem(): Promise<ClaimedItem | null> {
  return prisma.$transaction(async (tx) => {
    const due = await tx.scheduledItem.findFirst({
      where: { status: "PENDING", scheduledFor: { lte: new Date() }, clockWheelStepId: null },
      orderBy: [{ scheduledFor: "asc" }, { position: "asc" }],
      include: claimInclude,
    });
    const manual =
      due ??
      (await tx.scheduledItem.findFirst({
        where: { status: "PENDING", scheduledFor: null },
        orderBy: { position: "asc" },
        include: claimInclude,
      }));
    const next =
      manual ??
      (await tx.scheduledItem.findFirst({
        where: { status: "PENDING", clockWheelStepId: { not: null } },
        orderBy: { position: "asc" },
        include: claimInclude,
      }));
    if (!next) return null;

    const now = new Date();
    const media = next.song ?? next.jingle ?? next.ad ?? next.voiceTrack;
    if (!media) {
      throw new Error(`ScheduledItem ${next.id} has no song/jingle/ad/voiceTrack attached`);
    }

    await tx.scheduledItem.update({
      where: { id: next.id },
      data: { status: "PLAYED", playedAt: now },
    });

    // Durable history for separation-rule / least-recently-played lookups (see
    // clockWheelEngine.ts) -- the only writer of this table. Playback here is
    // deterministic (no separate "still playing" state elsewhere tracks actual
    // completion), so endedAt/durationMs are derived from the media's own known
    // duration rather than closed out later by some other event.
    await tx.playbackHistoryEntry.create({
      data: {
        mediaKind: PLAYBACK_MEDIA_KIND[next.mediaKind],
        songId: next.songId,
        jingleId: next.jingleId,
        adId: next.adId,
        voiceTrackId: next.voiceTrackId,
        source: next.clockWheelStepId ? "CLOCK_WHEEL" : next.scheduleRuleId ? "SCHEDULED_ITEM" : "MANUAL",
        clockWheelStepId: next.clockWheelStepId,
        scheduledItemId: next.id,
        startedAt: now,
        endedAt: new Date(now.getTime() + media.durationMs),
        durationMs: media.durationMs,
        titleSnapshot: media.title,
        artistSnapshot: next.song?.artist ?? null,
      },
    });

    return next;
  });
}

async function toTrackDirective(item: ClaimedItem): Promise<TrackDirectiveDTO> {
  const media = item.song ?? item.jingle ?? item.ad ?? item.voiceTrack;
  if (!media) {
    throw new Error(`ScheduledItem ${item.id} has no song/jingle/ad/voiceTrack attached`);
  }

  const ttlSeconds = Math.ceil(media.durationMs / 1000) + TRACK_URL_BUFFER_SECONDS;
  const url = await getPresignedGetUrl(media.fileKey, ttlSeconds);

  // Only songs crossfade (see QueueController.beginCrossfade) -- jingles/ads
  // have their own hard-cut/ducking behavior, so they carry no mix points.
  const mixPoints =
    item.mediaKind === "SONG" && item.song
      ? resolveMixPoints(
          {
            durationMs: item.song.durationMs,
            mixInPointMs: item.song.mixInPointMs,
            mixInDurationMs: item.song.mixInDurationMs,
            mixOutPointMs: item.song.mixOutPointMs,
            mixOutDurationMs: item.song.mixOutDurationMs,
          },
          await ensureStationSettings(),
        )
      : null;

  return {
    type: "track",
    requestId: randomUUID(),
    mediaKind: item.mediaKind,
    mediaId: item.songId ?? item.jingleId ?? item.adId ?? item.voiceTrackId ?? "",
    title: media.title,
    artist: item.song?.artist ?? null,
    // Only songs carry cover art in the schema -- streamed (not a direct
    // MinIO URL) same as the library's own cover-art route.
    coverArtUrl: item.song?.coverArtKey ? `/library/songs/${item.songId}/cover-art` : null,
    durationMs: media.durationMs,
    url,
    urlExpiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    mixInPointMs: mixPoints?.mixInPointMs ?? null,
    mixInDurationMs: mixPoints?.mixInDurationMs ?? null,
    mixOutPointMs: mixPoints?.mixOutPointMs ?? null,
    mixOutDurationMs: mixPoints?.mixOutDurationMs ?? null,
  };
}

// Fetched once at encoder boot (apps/encoder/src/api/apiClient.ts) to build
// its ffmpeg HLS argv -- there is no live-reload path, so this is a
// boot-time-only read, not a poll.
internalRoutes.get("/stream-settings", async (_req, res) => {
  const settings = await ensureStreamSettings();
  res.json(StreamSettingsSchema.parse(toStreamSettingsDTO(settings)));
});

internalRoutes.get("/playback/next", async (_req, res) => {
  const claimed = await claimNextQueueItem();

  let directive: PlaybackDirectiveDTO;
  if (claimed) {
    directive = await toTrackDirective(claimed);

    // Best-effort: a scheduler hiccup here must never break the encoder's next-track
    // fetch. Songs only, per the confirmed "each X songs played" scope.
    if (claimed.mediaKind === "SONG") {
      incrementSongPlayCountAndFire(new Date()).catch((err: unknown) => {
        logger.error({ err }, "failed to increment play-count schedule rules");
      });
    }
  } else {
    const silence: SilenceDirectiveDTO = {
      type: "silence",
      requestId: randomUUID(),
      reason: "queue-empty",
      retryAfterMs: 5000,
    };
    directive = silence;
  }

  res.json(PlaybackDirectiveSchema.parse(directive));
});
