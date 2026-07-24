import { Router } from "express";
import { NowPlayingSchema, type NowPlayingDTO } from "@spectado/shared-types";
import { publicRateLimit } from "../../middleware/rateLimit.js";
import { getNowPlaying } from "../nowPlaying/nowPlayingCache.js";

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
