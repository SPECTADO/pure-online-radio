import { prisma } from "@spectado/database";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { clockWheelsRoutes } from "./modules/clockWheels/clockWheels.routes.js";
import { externalStreamsRoutes } from "./modules/externalStreams/externalStreams.routes.js";
import { internalRoutes } from "./modules/internal/internal.routes.js";
import { adsRoutes } from "./modules/library/ads.routes.js";
import { categoriesRoutes } from "./modules/library/categories.routes.js";
import { jinglesRoutes } from "./modules/library/jingles.routes.js";
import { songsRoutes } from "./modules/library/songs.routes.js";
import { liveMicRoutes } from "./modules/liveMic/liveMic.routes.js";
import { publicRoutes } from "./modules/public/public.routes.js";
import { queueRoutes } from "./modules/queue/queue.routes.js";
import { realtimeRoutes } from "./modules/realtime/realtime.routes.js";
import { scheduleRoutes } from "./modules/schedule/schedule.routes.js";
import { separationRulesRoutes } from "./modules/settings/separationRules.routes.js";
import { isNatsConnected } from "./nats/client.js";
import { redis } from "./redis/client.js";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  // Same-origin via the nginx proxy in front of api/control-panel/player, so a
  // permissive reflect-origin CORS config is fine for v1.
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.get("/healthz", async (_req, res) => {
    const checks: Record<string, "ok" | "error"> = {
      database: "ok",
      redis: "ok",
      nats: "ok",
    };

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      checks.database = "error";
    }

    try {
      await redis.ping();
    } catch {
      checks.redis = "error";
    }

    if (!isNatsConnected()) {
      checks.nats = "error";
    }

    const healthy = Object.values(checks).every((status) => status === "ok");
    res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "error", checks });
  });

  app.use("/auth", authRoutes);
  app.use("/realtime", realtimeRoutes);
  app.use("/library/categories", categoriesRoutes);
  app.use("/library/songs", songsRoutes);
  app.use("/library/jingles", jinglesRoutes);
  app.use("/library/ads", adsRoutes);
  app.use("/queue", queueRoutes);
  app.use("/schedule", scheduleRoutes);
  app.use("/clock-wheels", clockWheelsRoutes);
  app.use("/settings/separation-rules", separationRulesRoutes);
  app.use("/external-streams", externalStreamsRoutes);
  app.use("/live-mic", liveMicRoutes);
  app.use("/internal", internalRoutes);
  app.use("/public", publicRoutes);

  app.use(errorHandler);

  return app;
}
