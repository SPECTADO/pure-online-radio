import { Prisma, prisma, type MediaKind, type SelectionStrategy } from "@spectado/database";
import { logger } from "../logger.js";
import { isSlotActiveAt } from "../lib/clockWheelSlot.js";
import { ensureStationSettings } from "../modules/settings/stationSettings.js";
import { MAX_CLOCK_WHEEL_FILL_ITEMS_PER_TICK } from "./constants.js";

const wheelInclude = { slots: true, steps: true } satisfies Prisma.ClockWheelInclude;
type WheelWithRelations = Prisma.ClockWheelGetPayload<{ include: typeof wheelInclude }>;
type Step = WheelWithRelations["steps"][number];

const PLAYBACK_MEDIA_KIND: Record<MediaKind, "SONG" | "JINGLE" | "AD" | "VOICE_TRACK"> = {
  SONG: "SONG",
  JINGLE: "JINGLE",
  AD: "AD",
  // Never actually produced for a clock-wheel step (the step-create UI only ever offers
  // SONG/JINGLE/AD -- see ClockWheelStepPicker.tsx), but MediaKind is a shared enum so this
  // Record must stay exhaustive over all 4 values to type-check.
  VOICE_TRACK: "VOICE_TRACK",
};

/** First active, non-default wheel with a slot matching `at`, else the default wheel
 * (`isDefault`) -- see clockWheels.routes.ts for why at most one non-default wheel can
 * ever match (overlapping slots between active wheels are rejected at write time). */
function findActiveWheel(at: Date, wheels: WheelWithRelations[]): WheelWithRelations | null {
  const specific = wheels.find(
    (wheel) => !wheel.isDefault && wheel.isActive && wheel.slots.some((slot) => isSlotActiveAt(slot, at)),
  );
  return specific ?? wheels.find((wheel) => wheel.isDefault) ?? null;
}

/** `wheel.rotationCursor % steps.length`, steps ordered by `order`. Callers that
 * successfully use the returned step are responsible for advancing `wheel.rotationCursor`
 * both in-memory (so subsequent calls in the same tick see the new position) and in the
 * database (so it persists across ticks/restarts). */
function pickNextStep(wheel: WheelWithRelations): Step | null {
  if (wheel.steps.length === 0) return null;
  const sorted = [...wheel.steps].sort((a, b) => a.order - b.order);
  const index = ((wheel.rotationCursor % sorted.length) + sorted.length) % sorted.length;
  return sorted[index]!;
}

interface Candidate {
  id: string;
  artist: string | null; // song only
  album: string | null; // song only
}

interface RecentPlay {
  id: string;
  artist: string | null;
  album: string | null;
  minutesAgo: number;
}

async function fetchCandidates(step: Step, expectedStart: Date): Promise<Candidate[]> {
  const categoryFilter = step.categoryId ? { categories: { some: { id: step.categoryId } } } : {};

  if (step.mediaKind === "SONG") {
    const tagFilter = step.tag ? { tags: { has: step.tag } } : {};
    const songs = await prisma.song.findMany({
      where: { isActive: true, ...categoryFilter, ...tagFilter },
      select: { id: true, artist: true, album: true },
    });
    return songs.map((s) => ({ id: s.id, artist: s.artist, album: s.album }));
  }

  if (step.mediaKind === "JINGLE") {
    const tagFilter = step.tag ? { tags: { has: step.tag } } : {};
    const jingles = await prisma.jingle.findMany({
      where: { isActive: true, ...categoryFilter, ...tagFilter },
      select: { id: true },
    });
    return jingles.map((j) => ({ id: j.id, artist: null, album: null }));
  }

  // AD -- no tags field on the model, and the mandatory active window is checked against
  // the item's *estimated* play time, not "now" (this may be filling hours ahead).
  const ads = await prisma.ad.findMany({
    where: {
      isActive: true,
      ...categoryFilter,
      activeFrom: { lte: expectedStart },
      activeUntil: { gte: expectedStart },
    },
    select: { id: true },
  });
  return ads.map((a) => ({ id: a.id, artist: null, album: null }));
}

/** Real past plays (PlaybackHistoryEntry). Scoped to the same media kind as `step` since
 * only same-kind rows could ever share a matching artist/album/id anyway. */
async function fetchRecentHistoryPlays(mediaKind: MediaKind, before: Date, sinceMinutes: number): Promise<RecentPlay[]> {
  if (sinceMinutes <= 0) return [];
  const since = new Date(before.getTime() - sinceMinutes * 60_000);
  const rows = await prisma.playbackHistoryEntry.findMany({
    where: { mediaKind: PLAYBACK_MEDIA_KIND[mediaKind], startedAt: { gte: since, lt: before } },
    select: {
      songId: true,
      jingleId: true,
      adId: true,
      startedAt: true,
      song: { select: { artist: true, album: true } },
    },
    orderBy: { startedAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.songId ?? row.jingleId ?? row.adId ?? "",
    artist: row.song?.artist ?? null,
    album: row.song?.album ?? null,
    minutesAgo: (before.getTime() - row.startedAt.getTime()) / 60_000,
  }));
}

/** Already-materialized-but-not-yet-played clock-wheel picks (this tick's fill so far,
 * plus any left over from earlier ticks) -- critical for separation to mean anything at
 * all, since a single fill pass generates a whole rotation ahead of real playback and
 * would otherwise be blind to what it just planned a few slots ago. Keyed by
 * `scheduledFor` (the estimate assigned when each was planned), which only ever moves
 * forward, so "< before" correctly captures everything planned earlier in the sequence. */
async function fetchRecentWheelPicks(mediaKind: MediaKind, before: Date, sinceMinutes: number): Promise<RecentPlay[]> {
  if (sinceMinutes <= 0) return [];
  const since = new Date(before.getTime() - sinceMinutes * 60_000);
  const rows = await prisma.scheduledItem.findMany({
    where: {
      mediaKind,
      clockWheelStepId: { not: null },
      status: "PENDING",
      scheduledFor: { gte: since, lt: before },
    },
    select: {
      songId: true,
      jingleId: true,
      adId: true,
      scheduledFor: true,
      song: { select: { artist: true, album: true } },
    },
    orderBy: { scheduledFor: "desc" },
  });
  return rows.map((row) => ({
    id: row.songId ?? row.jingleId ?? row.adId ?? "",
    artist: row.song?.artist ?? null,
    album: row.song?.album ?? null,
    minutesAgo: (before.getTime() - row.scheduledFor!.getTime()) / 60_000,
  }));
}

/** Minutes-since-last-play per candidate id (absent = never played), for the selection
 * strategies below -- merges real history with already-planned-but-unplayed clock-wheel
 * picks (same reasoning as fetchRecentWheelPicks), unbounded lookback either way. */
async function fetchLastPlayed(mediaKind: MediaKind, ids: string[], before: Date): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const idFilter =
    mediaKind === "SONG"
      ? { songId: { in: ids } }
      : mediaKind === "JINGLE"
        ? { jingleId: { in: ids } }
        : { adId: { in: ids } };

  const [historyRows, wheelRows] = await Promise.all([
    prisma.playbackHistoryEntry.findMany({
      where: { mediaKind: PLAYBACK_MEDIA_KIND[mediaKind], startedAt: { lt: before }, ...idFilter },
      select: { songId: true, jingleId: true, adId: true, startedAt: true },
      orderBy: { startedAt: "desc" },
    }),
    prisma.scheduledItem.findMany({
      where: { mediaKind, clockWheelStepId: { not: null }, status: "PENDING", scheduledFor: { lt: before }, ...idFilter },
      select: { songId: true, jingleId: true, adId: true, scheduledFor: true },
      orderBy: { scheduledFor: "desc" },
    }),
  ]);

  const map = new Map<string, number>();
  for (const row of historyRows) {
    const id = row.songId ?? row.jingleId ?? row.adId ?? "";
    const minutesAgo = (before.getTime() - row.startedAt.getTime()) / 60_000;
    const existing = map.get(id);
    if (existing === undefined || minutesAgo < existing) map.set(id, minutesAgo);
  }
  for (const row of wheelRows) {
    const id = row.songId ?? row.jingleId ?? row.adId ?? "";
    const minutesAgo = (before.getTime() - row.scheduledFor!.getTime()) / 60_000;
    const existing = map.get(id);
    if (existing === undefined || minutesAgo < existing) map.set(id, minutesAgo);
  }
  return map;
}

type SeparationTier = "full" | "songOnly" | "none";

/** "songOnly" keeps only the exact-same-item repeat check (`rules.song`) -- the tier this
 * relaxes to when nothing survives the full artist+album+song check, since avoiding an
 * exact repeat matters more than rotation variety. */
function violatesSeparation(
  candidate: Candidate,
  recent: RecentPlay[],
  rules: { artist: number; album: number; song: number },
  tier: SeparationTier,
): boolean {
  if (tier === "none") return false;
  for (const play of recent) {
    if (play.id === candidate.id && play.minutesAgo < rules.song) return true;
    if (tier !== "full") continue;
    if (candidate.artist && play.artist === candidate.artist && play.minutesAgo < rules.artist) return true;
    if (candidate.album && play.album === candidate.album && play.minutesAgo < rules.album) return true;
  }
  return false;
}

// Never-played tracks are treated as maximally stale (a very large but finite weight)
// rather than a separate always-wins tier -- they naturally dominate a WEIGHTED_RECENCY
// draw without a special case, and still lose to nothing (there's nothing staler).
const NEVER_PLAYED_WEIGHT_MINUTES = 100_000;

/** Dispatch table by design -- RANDOM/LEAST_RECENTLY_PLAYED/WEIGHTED_RECENCY today, more
 * strategies can be added as another case without restructuring callers. */
function selectFromPool(pool: Candidate[], strategy: SelectionStrategy, lastPlayedMinutesAgo: Map<string, number>): Candidate {
  if (strategy === "RANDOM") {
    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  if (strategy === "LEAST_RECENTLY_PLAYED") {
    return [...pool].sort((a, b) => {
      const aAgo = lastPlayedMinutesAgo.get(a.id) ?? Infinity;
      const bAgo = lastPlayedMinutesAgo.get(b.id) ?? Infinity;
      return bAgo - aAgo;
    })[0]!;
  }

  // WEIGHTED_RECENCY
  const weights = pool.map((c) => Math.max(1, lastPlayedMinutesAgo.get(c.id) ?? NEVER_PLAYED_WEIGHT_MINUTES));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

interface PickedMedia {
  mediaKind: MediaKind;
  id: string;
  durationMs: number;
}

/** Picks a concrete piece of media for `step` at its estimated `expectedStart`: category/
 * tag/active-window filters, then separation rules (progressively relaxed -- full, then
 * exact-repeat-only, then none -- if a tier's pool is empty, so a slot is never left
 * unfilled just because rotation variety can't be perfectly honored), then the step's
 * selection strategy. Returns null only if nothing matches the filters at all. */
async function pickMediaForStep(step: Step, expectedStart: Date): Promise<PickedMedia | null> {
  const candidates = await fetchCandidates(step, expectedStart);
  if (candidates.length === 0) return null;

  const separationRule = await prisma.separationRule.findFirst({ where: { scope: "GLOBAL" } });
  const rules = {
    artist: separationRule?.artistSeparationMinutes ?? 0,
    album: separationRule?.albumSeparationMinutes ?? 0,
    song: separationRule?.songSeparationMinutes ?? 0,
  };
  const lookbackMinutes = Math.max(rules.artist, rules.album, rules.song);
  const [historyRecent, wheelRecent] = await Promise.all([
    fetchRecentHistoryPlays(step.mediaKind, expectedStart, lookbackMinutes),
    fetchRecentWheelPicks(step.mediaKind, expectedStart, lookbackMinutes),
  ]);
  const recent = [...historyRecent, ...wheelRecent];

  let pool = candidates.filter((c) => !violatesSeparation(c, recent, rules, "full"));
  if (pool.length === 0) pool = candidates.filter((c) => !violatesSeparation(c, recent, rules, "songOnly"));
  if (pool.length === 0) pool = candidates;

  const lastPlayed = await fetchLastPlayed(
    step.mediaKind,
    pool.map((c) => c.id),
    expectedStart,
  );
  const picked = selectFromPool(pool, step.selectionStrategy, lastPlayed);

  const media =
    step.mediaKind === "SONG"
      ? await prisma.song.findUnique({ where: { id: picked.id }, select: { durationMs: true } })
      : step.mediaKind === "JINGLE"
        ? await prisma.jingle.findUnique({ where: { id: picked.id }, select: { durationMs: true } })
        : await prisma.ad.findUnique({ where: { id: picked.id }, select: { durationMs: true } });
  if (!media) return null; // deleted between the pick and this fetch -- vanishingly unlikely

  return { mediaKind: step.mediaKind, id: picked.id, durationMs: media.durationMs };
}

const timelineItemInclude = {
  song: { select: { durationMs: true } },
  jingle: { select: { durationMs: true } },
  ad: { select: { durationMs: true } },
} satisfies Prisma.ScheduledItemInclude;

/** Walks the already-PENDING timeline in the same 3-tier claim-priority order as
 * internal/playback/next's claimNextQueueItem (due schedule items, then manual queue,
 * then already-planned clock-wheel items), summing durationMs from `now` to find how much
 * is already covered and where a newly-generated item's estimated start time should begin. */
async function computeQueuedAhead(now: Date): Promise<{ coveredMs: number; cursor: Date; lastPosition: number }> {
  const [due, manual, wheelItems] = await Promise.all([
    prisma.scheduledItem.findMany({
      where: { status: "PENDING", clockWheelStepId: null, scheduledFor: { not: null } },
      include: timelineItemInclude,
      orderBy: [{ scheduledFor: "asc" }, { position: "asc" }],
    }),
    prisma.scheduledItem.findMany({
      where: { status: "PENDING", clockWheelStepId: null, scheduledFor: null },
      include: timelineItemInclude,
      orderBy: { position: "asc" },
    }),
    prisma.scheduledItem.findMany({
      where: { status: "PENDING", clockWheelStepId: { not: null } },
      include: timelineItemInclude,
      orderBy: { position: "asc" },
    }),
  ]);

  let coveredMs = 0;
  let lastPosition = 0;
  for (const item of [...due, ...manual, ...wheelItems]) {
    const media = item.song ?? item.jingle ?? item.ad;
    coveredMs += media?.durationMs ?? 0;
    lastPosition = Math.max(lastPosition, item.position);
  }
  return { coveredMs, cursor: new Date(now.getTime() + coveredMs), lastPosition };
}

/** The scheduler tick entry point: keeps the queue filled from clock-wheel rotation at
 * least `queuePlanningHorizonMinutes` ahead of `now`, generating one ScheduledItem at a
 * time (wheel -> step -> media) until the horizon is covered. Never gates a generated
 * item's claimability on its estimated `scheduledFor` -- see claimNextQueueItem. */
export async function evaluateClockWheelFill(now: Date): Promise<void> {
  const settings = await ensureStationSettings();
  const horizonMs = settings.queuePlanningHorizonMinutes * 60_000;

  const timeline = await computeQueuedAhead(now);
  let coveredMs = timeline.coveredMs;
  let cursor = timeline.cursor;
  let lastPosition = timeline.lastPosition;
  if (coveredMs >= horizonMs) return;

  const wheels = await prisma.clockWheel.findMany({ include: wheelInclude });
  if (wheels.length === 0) return; // not seeded yet -- nothing to fall back to

  let iterations = 0;
  while (coveredMs < horizonMs) {
    if (iterations >= MAX_CLOCK_WHEEL_FILL_ITEMS_PER_TICK) {
      logger.warn({ horizonMs, coveredMs }, "clock-wheel fill hit its per-tick safety cap -- continuing next tick");
      return;
    }
    iterations++;

    const wheel = findActiveWheel(cursor, wheels);
    if (!wheel) return; // no default wheel exists -- nothing to fall back to

    const step = pickNextStep(wheel);
    if (!step) {
      // Wheel has no steps configured yet -- nothing to fill from it. Advance the
      // cursor by a nominal amount so the loop doesn't spin on the same instant forever.
      coveredMs += 60_000;
      cursor = new Date(cursor.getTime() + 60_000);
      continue;
    }

    // In-memory advance so the next iteration's pickNextStep sees the new position too
    // (wheels is fetched once per tick); persisted alongside the new row below.
    wheel.rotationCursor += 1;

    const picked = await pickMediaForStep(step, cursor);
    if (!picked) {
      logger.warn(
        { wheelId: wheel.id, stepId: step.id, mediaKind: step.mediaKind },
        "clock-wheel step has no eligible media -- skipping this rotation slot",
      );
      await prisma.clockWheel.update({ where: { id: wheel.id }, data: { rotationCursor: wheel.rotationCursor } });
      continue;
    }

    lastPosition += 1;
    await prisma.$transaction([
      prisma.clockWheel.update({ where: { id: wheel.id }, data: { rotationCursor: wheel.rotationCursor } }),
      prisma.scheduledItem.create({
        data: {
          scheduledFor: cursor,
          position: lastPosition,
          mediaKind: picked.mediaKind,
          songId: picked.mediaKind === "SONG" ? picked.id : undefined,
          jingleId: picked.mediaKind === "JINGLE" ? picked.id : undefined,
          adId: picked.mediaKind === "AD" ? picked.id : undefined,
          status: "PENDING",
          clockWheelStepId: step.id,
          createdById: null,
        },
      }),
    ]);

    coveredMs += picked.durationMs;
    cursor = new Date(cursor.getTime() + picked.durationMs);
  }
}
