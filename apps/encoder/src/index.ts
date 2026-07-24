import { loadConfig } from "./config.js";
import { logger } from "./util/logger.js";
import { FifoWriter } from "./core/fifoWriter.js";
import { Mixer } from "./core/mixer.js";
import { FillerSource } from "./sources/fillerSource.js";
import { MasterEncoder } from "./process/masterEncoder.js";
import { NatsClient } from "./nats/natsClient.js";
import { startCommandRouter } from "./nats/commandRouter.js";
import { StatusPublisher } from "./nats/statusPublisher.js";
import { HealthMonitor } from "./health/healthMonitor.js";
import { ApiClient } from "./api/apiClient.js";
import { LiveMicServer } from "./ws/liveMicServer.js";

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ nodeEnv: config.nodeEnv, hlsOutputDir: config.hlsOutputDir, fifoPath: config.pcmFifoPath }, "starting spectado encoder");

  // --- the one thing that must genuinely work: FIFO -> filler tone -> ffmpeg HLS encode ---
  const masterEncoder = new MasterEncoder(config, logger);
  masterEncoder.start();

  const healthMonitor = new HealthMonitor(masterEncoder);

  const fifoWriter = new FifoWriter(config.pcmFifoPath, logger);
  fifoWriter.open();

  const fillerSource = new FillerSource();
  const mixer = new Mixer(fillerSource, fifoWriter, logger);
  mixer.start();

  // --- control plane: NATS commands in, status out ---
  const natsClient = await NatsClient.connect(config, logger);
  startCommandRouter(natsClient, logger);

  const statusPublisher = new StatusPublisher(natsClient, healthMonitor, logger);
  const heartbeatTimer = statusPublisher.startHeartbeatLoop(config.heartbeatIntervalMs);

  // --- API polling (proves connectivity; API is expected to return silence for now) ---
  const apiClient = new ApiClient(config, logger);
  apiClient.startPolling();

  // --- live mic websocket (stub: accepts connections, doesn't decode/mix yet) ---
  const liveMicServer = new LiveMicServer(config.liveMicWsPort, logger);
  liveMicServer.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down encoder");

    clearInterval(heartbeatTimer);
    apiClient.stopPolling();
    liveMicServer.stop();
    mixer.stop();
    masterEncoder.stop();
    fifoWriter.close();

    try {
      await natsClient.close();
    } catch (err) {
      logger.warn({ err }, "error closing NATS connection during shutdown");
    }

    logger.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaught exception");
    void shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "unhandled promise rejection");
  });
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "fatal error during encoder startup");
  process.exit(1);
});
