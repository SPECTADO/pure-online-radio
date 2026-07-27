import type { StreamSettingsDTO } from "@spectado/shared-types";
import { loadConfig } from "./config.js";
import { logger } from "./util/logger.js";
import type { Logger } from "./util/logger.js";
import { FifoWriter } from "./core/fifoWriter.js";
import { Mixer } from "./core/mixer.js";
import { SilenceSource } from "./sources/silenceSource.js";
import { MasterEncoder } from "./process/masterEncoder.js";
import { LowLatencyEncoder } from "./process/llHlsEncoder.js";
import { NatsClient } from "./nats/natsClient.js";
import { startCommandRouter } from "./nats/commandRouter.js";
import { StatusPublisher } from "./nats/statusPublisher.js";
import { HealthMonitor } from "./health/healthMonitor.js";
import { ApiClient, DEFAULT_STREAM_SETTINGS } from "./api/apiClient.js";
import { QueueController } from "./controllers/queueController.js";
import { JingleController } from "./controllers/jingleController.js";
import { RelayController } from "./controllers/relayController.js";
import { LiveMicServer } from "./ws/liveMicServer.js";

const BOOT_STREAM_SETTINGS_ATTEMPTS = 5;
const BOOT_STREAM_SETTINGS_RETRY_DELAY_MS = 1000;

/** Structural shape shared by MasterEncoder (standard, mpegts) and LowLatencyEncoder (real LL-HLS, ffmpeg+gpac). */
interface Encoder {
  start(): void;
  stop(): void;
  isHealthy(): boolean;
}

/**
 * Stream Settings (codec/bitrate/segment/low-latency) are read once here at
 * boot, not polled -- there is no live-reload path today, so a change only
 * takes effect the next time the encoder process restarts (see Settings ->
 * Stream Settings in the control panel). Retries a few times since the API
 * may not be up yet (same startup race as any other cross-service
 * dependency in this stack), then falls back to the pipeline's original
 * hardcoded defaults so a stream still comes up even if the API never
 * answers.
 */
async function fetchStreamSettingsAtBoot(apiClient: ApiClient, logger: Logger): Promise<StreamSettingsDTO> {
  for (let attempt = 1; attempt <= BOOT_STREAM_SETTINGS_ATTEMPTS; attempt++) {
    const settings = await apiClient.fetchStreamSettings();
    if (settings) return settings;
    logger.warn({ attempt, of: BOOT_STREAM_SETTINGS_ATTEMPTS }, "could not fetch stream settings from API at boot; retrying");
    await new Promise((resolve) => setTimeout(resolve, BOOT_STREAM_SETTINGS_RETRY_DELAY_MS));
  }
  logger.error("could not fetch stream settings from API after retries; falling back to defaults");
  return DEFAULT_STREAM_SETTINGS;
}

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ nodeEnv: config.nodeEnv, hlsOutputDir: config.hlsOutputDir, fifoPath: config.pcmFifoPath }, "starting spectado encoder");

  // --- the one thing that must genuinely work: FIFO -> mixer output -> HLS encode ---
  const apiClient = new ApiClient(config, logger);
  const streamSettings = await fetchStreamSettingsAtBoot(apiClient, logger);
  logger.info({ streamSettings }, "using stream settings");
  const encoder: Encoder = streamSettings.lowLatencyEnabled
    ? new LowLatencyEncoder(config, streamSettings, logger)
    : new MasterEncoder(config, streamSettings, logger);
  encoder.start();

  const healthMonitor = new HealthMonitor(encoder);

  const fifoWriter = new FifoWriter(config.pcmFifoPath, logger);
  fifoWriter.open();

  const mixer = new Mixer(new SilenceSource(), "none", fifoWriter, logger);
  mixer.start();

  // --- control plane: NATS commands in, status out ---
  const natsClient = await NatsClient.connect(config, logger);

  const statusPublisher = new StatusPublisher(natsClient, healthMonitor, mixer, logger, config.hlsOutputDir);
  const heartbeatTimer = statusPublisher.startHeartbeatLoop(config.heartbeatIntervalMs);

  // --- playback queue: real ffmpeg-decoded audio, one queue item after
  // another, falling back to silence when the queue empties ---
  const queueController = new QueueController(mixer, apiClient, statusPublisher, logger);
  const jingleController = new JingleController(mixer, statusPublisher, logger);
  const relayController = new RelayController(mixer, queueController, statusPublisher, logger);
  startCommandRouter(natsClient, logger, { queueController, jingleController, relayController });
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
    encoder.stop();
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
