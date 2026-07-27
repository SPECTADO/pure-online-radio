import type { RelayCancelCommand, RelayStartCommand, RelayStopCommand } from "@spectado/shared-types";
import type { Mixer } from "../core/mixer.js";
import type { StatusPublisher } from "../nats/statusPublisher.js";
import type { Logger } from "../util/logger.js";
import type { QueueController } from "./queueController.js";
import { RelaySource } from "../sources/relaySource.js";

interface ActiveRelay {
  relayId: string;
  source: RelaySource;
}

/**
 * REAL: mounts/unmounts the relay primary-slot source driven off scheduler-
 * published NATS commands (apps/api/src/scheduler/externalStreamScheduler.ts
 * decides *when* to send relay.start/relay.stop -- this controller just acts
 * on them). Suspends QueueController's own advance bookkeeping while a relay
 * is on the bus and hands playback back to it once the relay ends, is
 * stopped, or fails to connect.
 */
export class RelayController {
  private current: ActiveRelay | null = null;

  constructor(
    private readonly mixer: Mixer,
    private readonly queueController: QueueController,
    private readonly statusPublisher: StatusPublisher,
    private readonly logger: Logger,
  ) {}

  async handleRelayStart(command: RelayStartCommand): Promise<void> {
    this.teardownCurrent();
    this.queueController.suspendForRelay();

    const source = new RelaySource({ relayId: command.relayId, url: command.url, onFailure: command.onFailure }, this.logger);
    source.once("ended", () => this.finishRelay(command.relayId, "stopped"));
    source.once("failed", () => this.finishRelay(command.relayId, "failed"));

    this.current = { relayId: command.relayId, source };
    this.mixer.setPrimarySource(source, "relay");
    this.logger.info({ relayId: command.relayId, url: command.url }, "relay mounted as primary source");

    const ts = new Date().toISOString();
    this.statusPublisher.publishNowPlaying({
      ts,
      trackId: null,
      isLive: true,
      type: "external_relay",
      title: command.name,
      artist: null,
      album: null,
      coverArtUrl: null,
      startedAt: ts,
      durationMs: null,
      mode: this.queueController.currentMode,
    });
    this.statusPublisher.publishRelayStarted({ ts, relayId: command.relayId });
  }

  async handleRelayStop(command: RelayStopCommand): Promise<void> {
    this.finishRelay(command.relayId, "stopped");
  }

  async handleRelayCancel(command: RelayCancelCommand): Promise<void> {
    // Nothing currently publishes relay.cancel (the DELETE route only ever
    // sends relay.stop -- see externalStreams.routes.ts), so this is a
    // defensive mirror of handleRelayStop, not an exercised path today.
    this.finishRelay(command.relayId, "stopped");
  }

  /** Guards against a stale/duplicate "ended"/"failed" firing after the relay was already torn down by a stop/cancel. */
  private finishRelay(relayId: string, reason: "stopped" | "failed"): void {
    if (this.current?.relayId !== relayId) return;
    this.teardownCurrent();
    this.logger.info({ relayId, reason }, "relay ended; resuming queue");
    this.queueController.resumeAfterRelay();
    this.statusPublisher.publishRelayEnded({ ts: new Date().toISOString(), relayId, reason });
  }

  private teardownCurrent(): void {
    if (this.current) {
      this.current.source.removeAllListeners();
      this.current.source.destroy();
      this.current = null;
    }
  }
}
