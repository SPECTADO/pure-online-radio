import { prisma } from "@spectado/database";
import type { MediaKind } from "@spectado/shared-types";

/** Looks up a Song/Jingle/Ad by id, dispatching on mediaKind -- shared by any route that
 * accepts a (mediaKind, mediaId) pair (manual queue, schedule-rule items). */
export function findActiveMedia(mediaKind: MediaKind, mediaId: string) {
  if (mediaKind === "SONG") return prisma.song.findUnique({ where: { id: mediaId } });
  if (mediaKind === "JINGLE") return prisma.jingle.findUnique({ where: { id: mediaId } });
  return prisma.ad.findUnique({ where: { id: mediaId } });
}
