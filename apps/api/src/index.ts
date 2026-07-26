import { createServer } from "node:http";
import { prisma } from "@spectado/database";
import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { logger } from "./logger.js";
import { connectNats, disconnectNats } from "./nats/client.js";
import { startEncoderStatusSubscriber } from "./nats/subscriber.js";
import { redis } from "./redis/client.js";
import { startScheduler, stopScheduler } from "./scheduler/index.js";

async function main(): Promise<void> {
  // Prisma connects lazily on first query; referencing the singleton here just
  // makes bootstrap order explicit (it's already imported by app.ts's routes).
  void prisma;

  await connectNats();
  startEncoderStatusSubscriber();
  const schedulerTimer = startScheduler();

  const app = createApp();
  const server = createServer(app);

  server.listen(config.port, () => {
    logger.info({ port: config.port }, "api listening");
  });

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    stopScheduler(schedulerTimer);
    server.close();

    await Promise.allSettled([disconnectNats(), redis.quit(), prisma.$disconnect()]);

    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "fatal error during bootstrap");
  process.exit(1);
});
