import type { JinglePlayCommand, JingleStopCommand } from "@spectado/shared-types";
import type { Mixer } from "../core/mixer.js";
import type { StatusPublisher } from "../nats/statusPublisher.js";
import type { Logger } from "../util/logger.js";
import { JingleSource } from "../sources/jingleSource.js";

/**
 * REAL: mounts/unmounts the jingle overlay `Slot` (core/mixer.ts) driven off
 * NATS commands, independent of the queue's primary-slot playback. Publishes
 * jingleStarted/jingleEnded status so the control panel can show a
 * countdown for the standalone jingle alongside whatever the queue is
 * currently playing.
 */
export class JingleController {
  private current: { source: JingleSource; jingleId: string } | null = null;

  constructor(
    private readonly mixer: Mixer,
    private readonly statusPublisher: StatusPublisher,
    private readonly logger: Logger,
  ) {}

  async handleJinglePlay(command: JinglePlayCommand): Promise<void> {
    this.teardownCurrent();

    const source = new JingleSource(command, this.logger);
    source.once("ended", () => {
      if (this.current?.source === source) {
        this.current = null;
        this.mixer.clearJingleSource();
        this.statusPublisher.publishJingleEnded({ ts: new Date().toISOString(), jingleId: command.jingleId });
      }
    });

    this.current = { source, jingleId: command.jingleId };
    this.mixer.setJingleSource(source, source.buildGainEnvelope(), command.duckDb);
    this.logger.info({ jingleId: command.jingleId }, "jingle overlay mounted");

    this.statusPublisher.publishJingleStarted({
      ts: new Date().toISOString(),
      jingleId: command.jingleId,
      title: command.title,
      durationMs: command.durationMs,
    });
  }

  async handleJingleStop(_command: JingleStopCommand): Promise<void> {
    if (!this.current) return;
    const { jingleId } = this.current;
    this.teardownCurrent();
    this.mixer.clearJingleSource();
    this.statusPublisher.publishJingleEnded({ ts: new Date().toISOString(), jingleId });
  }

  private teardownCurrent(): void {
    if (this.current) {
      this.current.source.removeAllListeners("ended");
      this.current.source.destroy();
      this.current = null;
    }
  }
}
