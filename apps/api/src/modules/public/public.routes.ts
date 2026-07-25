import { Router } from "express";
import { prisma } from "@spectado/database";
import { NowPlayingSchema, StationSettingsSchema, type NowPlayingDTO } from "@spectado/shared-types";
import { publicRateLimit } from "../../middleware/rateLimit.js";
import { getObjectStream } from "../../lib/storage.js";
import { getNowPlaying } from "../nowPlaying/nowPlayingCache.js";
import { ensureStationSettings, toStationSettingsDTO } from "../settings/stationSettings.js";

export const publicRoutes = Router();

publicRoutes.use(publicRateLimit);

const FALLBACK_NOW_PLAYING: NowPlayingDTO = {
  isLive: false,
  type: "silence",
  title: null,
  artist: null,
  album: null,
  coverArtUrl: null,
  startedAt: null,
  durationMs: null,
  mode: "LIVE",
};

publicRoutes.get("/now-playing", async (_req, res) => {
  const cached = await getNowPlaying();
  res.json(NowPlayingSchema.parse(cached ?? FALLBACK_NOW_PLAYING));
});

publicRoutes.get("/station", async (_req, res) => {
  const settings = await ensureStationSettings();
  res.json(StationSettingsSchema.parse(toStationSettingsDTO(settings)));
});

// Streamed (not a direct MinIO URL, which a browser can never reach) --
// same reasoning as the library's cover-art routes, just public + singleton.
publicRoutes.get("/station/logo", async (_req, res) => {
  const settings = await prisma.stationSettings.findFirst({ select: { logoKey: true } });
  if (!settings?.logoKey) {
    res.status(404).json({ error: "no station logo set" });
    return;
  }

  const { body, contentType } = await getObjectStream(settings.logoKey);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=300");
  body.pipe(res);
});
