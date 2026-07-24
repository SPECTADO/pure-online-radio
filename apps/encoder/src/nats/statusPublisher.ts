import {
  NATS_SUBJECTS,
  HeartbeatStatusSchema,
  ErrorStatusSchema,
  type HeartbeatStatus,
  type ErrorStatus,
} from "@spectado/shared-types";
import type { NatsClient } from "./natsClient.js";
import type { HealthMonitor } from "../health/healthMonitor.js";
import type { Logger } from "../util/logger.js";

/**
 * REAL: publishes HeartbeatStatus/ErrorStatus, validated against the
 * shared-types schemas, over NATS. `activeSlots.primary` is hardcoded to
 * "filler" and `mixerUnderruns` to 0 for this pass, per spec - there is
 * nothing else playing yet and the mixer's real underrun counter isn't wired
 * through here (see core/mixer.ts Mixer.underrunCount for where that value
 * actually lives once this is worth reporting accurately).
 */
export class StatusPublisher {
  constructor(
    private readonly natsClient: NatsClient,
    private readonly healthMonitor: HealthMonitor,
    private readonly logger: Logger,
  ) {}

  publishHeartbeat(): void {
    const status: HeartbeatStatus = {
      ts: new Date().toISOString(),
      uptimeSec: this.healthMonitor.uptimeSec(),
      activeSlots: {
        primary: "filler",
        jingle: false,
        mic: false,
      },
      mixerUnderruns: 0,
      hlsWriterHealthy: this.healthMonitor.isMasterEncoderHealthy(),
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
