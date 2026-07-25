import { randomUUID } from "node:crypto";
import { Router } from "express";
import { Prisma, prisma } from "@spectado/database";
import {
  PlaybackDirectiveSchema,
  type PlaybackDirectiveDTO,
  type SilenceDirectiveDTO,
  type TrackDirectiveDTO,
} from "@spectado/shared-types";
import { internalOnly } from "../../middleware/internalOnly.js";
import { getPresignedGetUrl } from "../../lib/storage.js";

export const internalRoutes = Router();

internalRoutes.use(internalOnly);

const claimInclude = { song: true, jingle: true, ad: true } satisfies Prisma.ScheduledItemInclude;
type ClaimedItem = Prisma.ScheduledItemGetPayload<{ include: typeof claimInclude }>;

const TRACK_URL_BUFFER_SECONDS = 120;

/**
 * Atomically pops the head of the manual queue (lowest `position` among
 * PENDING, unscheduled ScheduledItems) and marks it PLAYED. There is no
 * separate "now playing" queue-row state (ScheduledItemStatus has no
 * PLAYING) -- being handed out for playback *is* "played" as far as the
 * queue table is concerned; the encoder/NATS status stream is the source of
 * truth for what's actually audible right now. Only one caller may ever
 * invoke this (the encoder's own advance-driven fetch) since it has a real
 * side effect -- see apps/encoder/src/api/apiClient.ts.
 */
async function claimNextQueueItem(): Promise<ClaimedItem | null> {
  return prisma.$transaction(async (tx) => {
    const next = await tx.scheduledItem.findFirst({
      where: { status: "PENDING", scheduledFor: null },
      orderBy: { position: "asc" },
      include: claimInclude,
    });
    if (!next) return null;

    await tx.scheduledItem.update({
      where: { id: next.id },
      data: { status: "PLAYED", playedAt: new Date() },
    });
    return next;
  });
}

async function toTrackDirective(item: ClaimedItem): Promise<TrackDirectiveDTO> {
  const media = item.song ?? item.jingle ?? item.ad;
  if (!media) {
    throw new Error(`ScheduledItem ${item.id} has no song/jingle/ad attached`);
  }

  const ttlSeconds = Math.ceil(media.durationMs / 1000) + TRACK_URL_BUFFER_SECONDS;
  const url = await getPresignedGetUrl(media.fileKey, ttlSeconds);

  return {
    type: "track",
    requestId: randomUUID(),
    mediaKind: item.mediaKind,
    mediaId: item.songId ?? item.jingleId ?? item.adId ?? "",
    title: media.title,
    artist: item.song?.artist ?? null,
    // Only songs carry cover art in the schema -- streamed (not a direct
    // MinIO URL) same as the library's own cover-art route.
    coverArtUrl: item.song?.coverArtKey ? `/library/songs/${item.songId}/cover-art` : null,
    durationMs: media.durationMs,
    url,
    urlExpiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
}

internalRoutes.get("/playback/next", async (_req, res) => {
  const claimed = await claimNextQueueItem();

  let directive: PlaybackDirectiveDTO;
  if (claimed) {
    directive = await toTrackDirective(claimed);
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
