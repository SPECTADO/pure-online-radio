import { NowPlayingSchema, type NowPlayingDTO } from "@spectado/shared-types";
import { redis } from "../../redis/client.js";

const NOW_PLAYING_KEY = "now-playing:current";

export async function setNowPlaying(dto: NowPlayingDTO): Promise<void> {
  await redis.set(NOW_PLAYING_KEY, JSON.stringify(dto));
}

/** Returns null if nothing has been cached yet (or the cached value is malformed). */
export async function getNowPlaying(): Promise<NowPlayingDTO | null> {
  const raw = await redis.get(NOW_PLAYING_KEY);
  if (!raw) {
    return null;
  }

  const result = NowPlayingSchema.safeParse(JSON.parse(raw));
  return result.success ? result.data : null;
}
