import {
  NATS_SUBJECTS,
  HeartbeatStatusSchema,
  ErrorStatusSchema,
  NowPlayingStatusSchema,
  QueueAdvancedStatusSchema,
  JingleStartedStatusSchema,
  JingleEndedStatusSchema,
  RelayStartedStatusSchema,
  RelayEndedStatusSchema,
  LiveStartedStatusSchema,
  LiveEndedStatusSchema,
  type HeartbeatStatus,
  type ErrorStatus,
  type NowPlayingStatus,
  type QueueAdvancedStatus,
  type JingleStartedStatus,
  type JingleEndedStatus,
  type RelayStartedStatus,
  type RelayEndedStatus,
  type LiveStartedStatus,
  type LiveEndedStatus,
} from "@spectado/shared-types";
import type { NatsClient } from "./natsClient.js";
import type { HealthMonitor } from "../health/healthMonitor.js";
import { getCurrentSegmentFilename } from "../health/currentSegment.js";
import type { Mixer } from "../core/mixer.js";
import type { Logger } from "../util/logger.js";

/**
 * REAL: publishes every encoder status message, validated against the
 * shared-types schemas, over NATS. The heartbeat's `activeSlots`/
 * `mixerUnderruns` reflect the mixer's actual live state (primarySlotKind /
 * jingleActive / underrunCount) rather than the original pass's hardcoded
 * "filler"/0 placeholders, now that the mixer really swaps sources.
 */
export class StatusPublisher {
  constructor(
    private readonly natsClient: NatsClient,
    private readonly healthMonitor: HealthMonitor,
    private readonly mixer: Mixer,
    private readonly logger: Logger,
    private readonly hlsOutputDir: string,
  ) {}

  publishHeartbeat(): void {
    const status: HeartbeatStatus = {
      ts: new Date().toISOString(),
      uptimeSec: this.healthMonitor.uptimeSec(),
      activeSlots: {
        primary: this.mixer.primarySlotKind,
        jingle: this.mixer.jingleActive,
        mic: this.mixer.micActive,
      },
      mixerUnderruns: this.mixer.underrunCount,
      hlsWriterHealthy: this.healthMonitor.isMasterEncoderHealthy(),
      currentSegment: getCurrentSegmentFilename(this.hlsOutputDir),
    };
    const validated = HeartbeatStatusSchema.parse(status);
    this.natsClient.publish(NATS_SUBJECTS.encoderStatus.heartbeat, validated);
    this.logger.debug({ status: validated }, "published heartbeat");
  }

  publishError(component: string, message: string, severity: ErrorStatus["severity"] = "warning", willRetry = true): void {
    const status: ErrorStatus = {
      ts: new Date().toISOString(),
      severity,
      component,
      message,
      willRetry,
    };
    const validated = ErrorStatusSchema.parse(status);
    this.natsClient.publish(NATS_SUBJECTS.encoderStatus.error, validated);
    this.logger.warn({ status: validated }, "published error status");
  }

  publishNowPlaying(status: NowPlayingStatus): void {
    const validated = NowPlayingStatusSchema.parse(status);
    this.natsClient.publish(NATS_SUBJECTS.encoderStatus.nowPlaying, validated);
    this.logger.debug({ status: validated }, "published now playing");
  }

  publishQueueAdvanced(status: QueueAdvancedStatus): void {
    const validated = QueueAdvancedStatusSchema.parse(status);
    this.natsClient.publish(NATS_SUBJECTS.encoderStatus.queueAdvanced, validated);
    this.logger.debug({ status: validated }, "published queue advanced");
  }

  publishJingleStarted(status: JingleStartedStatus): void {
    const validated = JingleStartedStatusSchema.parse(status);
    this.natsClient.publish(NATS_SUBJECTS.encoderStatus.jingleStarted, validated);
    this.logger.debug({ status: validated }, "published jingle started");
  }

  publishJingleEnded(status: JingleEndedStatus): void {
    const validated = JingleEndedStatusSchema.parse(status);
    this.natsClient.publish(NATS_SUBJECTS.encoderStatus.jingleEnded, validated);
    this.logger.debug({ status: validated }, "published jingle ended");
  }

  publishRelayStarted(status: RelayStartedStatus): void {
    const validated = RelayStartedStatusSchema.parse(status);
    this.natsClient.publish(NATS_SUBJECTS.encoderStatus.relayStarted, validated);
    this.logger.debug({ status: validated }, "published relay started");
  }

  publishRelayEnded(status: RelayEndedStatus): void {
    const validated = RelayEndedStatusSchema.parse(status);
    this.natsClient.publish(NATS_SUBJECTS.encoderStatus.relayEnded, validated);
    this.logger.debug({ status: validated }, "published relay ended");
  }

  publishLiveStarted(status: LiveStartedStatus): void {
    const validated = LiveStartedStatusSchema.parse(status);
    this.natsClient.publish(NATS_SUBJECTS.encoderStatus.liveStarted, validated);
    this.logger.debug({ status: validated }, "published live started");
  }

  publishLiveEnded(status: LiveEndedStatus): void {
    const validated = LiveEndedStatusSchema.parse(status);
    this.natsClient.publish(NATS_SUBJECTS.encoderStatus.liveEnded, validated);
    this.logger.debug({ status: validated }, "published live ended");
  }

  /** Starts the heartbeat interval and returns the timer so callers can clear it on shutdown. */
  startHeartbeatLoop(intervalMs: number): NodeJS.Timeout {
    return setInterval(() => {
      try {
        this.publishHeartbeat();
      } catch (err) {
        this.logger.error({ err }, "failed to publish heartbeat");
      }
    }, intervalMs);
  }
}
