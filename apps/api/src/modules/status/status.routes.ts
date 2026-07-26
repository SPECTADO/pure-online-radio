import { Router } from "express";
import { prisma } from "@spectado/database";
import {
  SystemStatusSchema,
  type CategoryLibraryStatsDTO,
  type ComponentStatusDTO,
  type LibraryStatsDTO,
  type SystemStatusDTO,
} from "@spectado/shared-types";
import { logger } from "../../logger.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { getStorageStats, isStorageHealthy } from "../../lib/storage.js";
import { getNatsUptimeSec, isNatsConnected } from "../../nats/client.js";
import { getRedisUptimeSec, redis } from "../../redis/client.js";
import { getLatestHeartbeat } from "./heartbeatCache.js";

export const statusRoutes = Router();

statusRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}

function checkApi(): ComponentStatusDTO {
  return { key: "api", label: "API", health: "ok", uptimeSec: process.uptime(), message: null };
}

async function checkDatabase(): Promise<ComponentStatusDTO> {
  try {
    // extract(epoch FROM ...) comes back as Prisma's arbitrary-precision
    // Decimal wrapper, not a plain number -- Number() unwraps it via its
    // valueOf()/toString(), same as any other Prisma Decimal field.
    const rows = await prisma.$queryRaw<
      { uptimeSec: unknown }[]
    >`SELECT extract(epoch FROM now() - pg_postmaster_start_time()) AS "uptimeSec"`;
    const uptimeSec = rows[0]?.uptimeSec != null ? Number(rows[0].uptimeSec) : null;
    return { key: "database", label: "Database (Postgres)", health: "ok", uptimeSec, message: null };
  } catch (err) {
    return { key: "database", label: "Database (Postgres)", health: "error", uptimeSec: null, message: describeError(err) };
  }
}

async function checkRedis(): Promise<ComponentStatusDTO> {
  try {
    await redis.ping();
    return { key: "redis", label: "Redis", health: "ok", uptimeSec: await getRedisUptimeSec(), message: null };
  } catch (err) {
    return { key: "redis", label: "Redis", health: "error", uptimeSec: null, message: describeError(err) };
  }
}

async function checkNats(): Promise<ComponentStatusDTO> {
  const connected = isNatsConnected();
  return {
    key: "nats",
    label: "NATS",
    health: connected ? "ok" : "error",
    uptimeSec: connected ? await getNatsUptimeSec() : null,
    message: connected ? null : "not connected",
  };
}

async function checkStorage(): Promise<ComponentStatusDTO> {
  const healthy = await isStorageHealthy();
  return {
    key: "storage",
    label: "Object storage (MinIO)",
    health: healthy ? "ok" : "error",
    uptimeSec: null,
    message: healthy ? null : "bucket unreachable",
  };
}

// 3x the encoder's default 5s heartbeat interval (HEARTBEAT_INTERVAL_MS) --
// enough slack for a slow tick without flagging a merely-late heartbeat as down.
const HEARTBEAT_STALE_MS = 15_000;

function checkEncoder(): ComponentStatusDTO {
  const heartbeat = getLatestHeartbeat();
  if (!heartbeat) {
    return { key: "encoder", label: "Encoder", health: "unknown", uptimeSec: null, message: "no heartbeat received yet" };
  }

  const ageMs = Date.now() - heartbeat.receivedAt;
  if (ageMs > HEARTBEAT_STALE_MS) {
    return {
      key: "encoder",
      label: "Encoder",
      health: "error",
      uptimeSec: heartbeat.status.uptimeSec,
      message: `no heartbeat for ${Math.round(ageMs / 1000)}s`,
    };
  }

  return {
    key: "encoder",
    label: "Encoder",
    health: heartbeat.status.hlsWriterHealthy ? "ok" : "degraded",
    uptimeSec: heartbeat.status.uptimeSec,
    message: heartbeat.status.hlsWriterHealthy ? null : "HLS writer unhealthy",
  };
}

/**
 * The api container shares the `edge` docker network with `webserver` (see
 * docker-compose.yml), so these are real reachability checks of the nginx
 * front door and the static bundles it serves -- not merely inferred from
 * "this request reached the api", since the control panel's dev-HMR server
 * talks to the api directly and can bypass nginx entirely.
 */
async function checkHttp(key: string, label: string, path: string): Promise<ComponentStatusDTO> {
  try {
    const res = await fetch(`http://webserver${path}`, { signal: AbortSignal.timeout(2000) });
    return {
      key,
      label,
      health: res.ok ? "ok" : "degraded",
      uptimeSec: null,
      message: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    return { key, label, health: "error", uptimeSec: null, message: describeError(err) };
  }
}

/** null (not thrown) on failure -- a downed Postgres/MinIO must not 500 the
 * whole status page when the "components" section above is there precisely
 * to report that same outage. */
async function safely<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err }, "[status] stats query failed");
    return null;
  }
}

async function getLibraryStats(): Promise<LibraryStatsDTO> {
  const [songsTotal, songsActive, jinglesTotal, jinglesActive, adsTotal, adsActive, categories] = await Promise.all([
    prisma.song.count(),
    prisma.song.count({ where: { isActive: true } }),
    prisma.jingle.count(),
    prisma.jingle.count({ where: { isActive: true } }),
    prisma.ad.count(),
    prisma.ad.count({ where: { isActive: true } }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            songs: { where: { isActive: true } },
            jingles: { where: { isActive: true } },
            ads: { where: { isActive: true } },
          },
        },
      },
    }),
  ]);

  const byCategory: CategoryLibraryStatsDTO[] = categories.map((category) => ({
    categoryId: category.id,
    categoryName: category.name,
    activeSongs: category._count.songs,
    activeJingles: category._count.jingles,
    activeAds: category._count.ads,
  }));

  return {
    songs: { total: songsTotal, active: songsActive },
    jingles: { total: jinglesTotal, active: jinglesActive },
    ads: { total: adsTotal, active: adsActive },
    byCategory,
  };
}

statusRoutes.get("/", async (_req, res) => {
  const [components, library, storage, queuedItemCount] = await Promise.all([
    Promise.all([
      checkApi(),
      checkDatabase(),
      checkRedis(),
      checkNats(),
      checkStorage(),
      checkEncoder(),
      checkHttp("webserver", "Web server (nginx)", "/env-config.js"),
      checkHttp("control-panel", "Control Panel", "/manage/"),
      checkHttp("player", "Web Player", "/"),
    ]),
    safely(getLibraryStats),
    safely(getStorageStats),
    safely(() => prisma.scheduledItem.count({ where: { status: "PENDING", scheduledFor: null } })),
  ]);

  const status: SystemStatusDTO = {
    generatedAt: new Date().toISOString(),
    components,
    library,
    storage,
    queuedItemCount,
  };
  res.json(SystemStatusSchema.parse(status));
});
