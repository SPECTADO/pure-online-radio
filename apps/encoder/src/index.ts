import { loadConfig } from "./config.js";
import { logger } from "./util/logger.js";
import { FifoWriter } from "./core/fifoWriter.js";
import { Mixer } from "./core/mixer.js";
import { SilenceSource } from "./sources/silenceSource.js";
import { MasterEncoder } from "./process/masterEncoder.js";
import { NatsClient } from "./nats/natsClient.js";
import { startCommandRouter } from "./nats/commandRouter.js";
import { StatusPublisher } from "./nats/statusPublisher.js";
import { HealthMonitor } from "./health/healthMonitor.js";
import { ApiClient } from "./api/apiClient.js";
import { QueueController } from "./controllers/queueController.js";
import { JingleController } from "./controllers/jingleController.js";
import { LiveMicServer } from "./ws/liveMicServer.js";

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ nodeEnv: config.nodeEnv, hlsOutputDir: config.hlsOutputDir, fifoPath: config.pcmFifoPath }, "starting spectado encoder");

  // --- the one thing that must genuinely work: FIFO -> mixer output -> ffmpeg HLS encode ---
  const masterEncoder = new MasterEncoder(config, logger);
  masterEncoder.start();

  const healthMonitor = new HealthMonitor(masterEncoder);

  const fifoWriter = new FifoWriter(config.pcmFifoPath, logger);
  fifoWriter.open();

  const mixer = new Mixer(new SilenceSource(), "none", fifoWriter, logger);
  mixer.start();

  // --- control plane: NATS commands in, status out ---
  const natsClient = await NatsClient.connect(config, logger);

  const statusPublisher = new StatusPublisher(natsClient, healthMonitor, mixer, logger);
  const heartbeatTimer = statusPublisher.startHeartbeatLoop(config.heartbeatIntervalMs);

  // --- playback queue: real ffmpeg-decoded audio, one queue item after
  // another, falling back to silence when the queue empties ---
  const apiClient = new ApiClient(config, logger);
  const queueController = new QueueController(mixer, apiClient, statusPublisher, logger);
  const jingleController = new JingleController(mixer, statusPublisher, logger);
  startCommandRouter(natsClient, logger, { queueController, jingleController });
  queueController.start();

  // --- live mic websocket (stub: accepts connections, doesn't decode/mix yet) ---
  const liveMicServer = new LiveMicServer(config.liveMicWsPort, logger);
  liveMicServer.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down encoder");

    clearInterval(heartbeatTimer);
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
