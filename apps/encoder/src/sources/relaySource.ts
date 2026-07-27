import { EventEmitter } from "node:events";
import type { Source } from "../core/types.js";
import { FRAME_BYTES } from "../core/types.js";
import { bufferToFloat32Frame, PcmFramer } from "../core/pcmFraming.js";
import { RingBuffer } from "../core/ringBuffer.js";
import { FfmpegProcess } from "../process/ffmpegProcess.js";
import { ProcessSupervisor } from "../process/processSupervisor.js";
import type { Logger } from "../util/logger.js";

/** ~5s of buffered audio at 20ms/frame -- same headroom as QueueSource. */
const RING_BUFFER_CAPACITY_FRAMES = 250;
/** How long to wait for the first audio frame before treating the relay as failed-to-connect. */
const CONNECT_TIMEOUT_MS = 10_000;

export interface RelayDirective {
  relayId: string;
  url: string;
  onFailure: "retry" | "fallbackToQueue";
}

/**
 * REAL: decodes an external relay `url` via a supervised ffmpeg process,
 * mirroring QueueSource's decode pipeline (PcmFramer -> RingBuffer) but
 * wrapping ffmpeg in a ProcessSupervisor instead of a one-shot process --
 * unlike a queue track's presigned MinIO url, a relay upstream can be a live
 * feed that drops mid-play and needs reconnecting, not just decoded once.
 *
 * Emits:
 *  - "ended": ffmpeg exited cleanly (code 0) -- the relay legitimately
 *    finished (on-demand EOF). Stops the supervisor first so it doesn't
 *    respawn a source that's done.
 *  - "failed": `onFailure` is "fallbackToQueue" and no audio was ever
 *    received within CONNECT_TIMEOUT_MS of starting. Never applies once
 *    connected -- a later drop is just a reconnect (see ProcessSupervisor's
 *    own backoff), not a failure. Never emitted when `onFailure` is "retry",
 *    which relies solely on the supervisor's infinite backoff instead.
 */
export class RelaySource extends EventEmitter implements Source {
  private readonly framer = new PcmFramer(FRAME_BYTES);
  private readonly ring = new RingBuffer<Buffer>(RING_BUFFER_CAPACITY_FRAMES);
  private readonly supervisor: ProcessSupervisor;
  private connected = false;
  private endedEmitted = false;
  private destroyed = false;
  private connectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly directive: RelayDirective,
    private readonly logger: Logger,
  ) {
    super();
    this.supervisor = new ProcessSupervisor(
      () => this.buildProcess(),
      this.logger.child({ component: "relaySource", relayId: directive.relayId }),
    );
    this.supervisor.start();

    if (directive.onFailure === "fallbackToQueue") {
      this.connectTimer = setTimeout(() => {
        this.connectTimer = null;
        if (this.connected || this.destroyed) return;
        this.logger.warn(
          { relayId: directive.relayId, url: directive.url },
          "relay never connected within timeout; falling back to queue",
        );
        this.supervisor.stop();
        this.emit("failed");
      }, CONNECT_TIMEOUT_MS);
    }
  }

  private isHttpUrl(): boolean {
    try {
      const protocol = new URL(this.directive.url).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }

  private buildProcess(): FfmpegProcess {
    this.framer.reset();

    const args = ["-nostdin", "-hide_banner", "-loglevel", "warning", "-re"];
    // -reconnect/-reconnect_streamed are http(s)-protocol-only AVOptions --
    // ffmpeg hard-fails with "Option not found" against any other protocol
    // (verified directly), so only add them when the url scheme supports it.
    // Deliberately omitting -reconnect_at_eof: that would make ffmpeg retry
    // instead of cleanly exiting on a genuinely-finished on-demand file,
    // which would break the natural-end ("ended") path below.
    if (this.isHttpUrl()) {
      args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5");
    }
    args.push("-i", this.directive.url, "-f", "f32le", "-ar", "48000", "-ac", "2", "pipe:1");

    const proc = new FfmpegProcess("ffmpeg", args, this.logger);

    proc.on("stdout", (chunk: Buffer) => {
      if (this.destroyed) return;
      if (!this.connected) {
        this.connected = true;
        if (this.connectTimer) {
          clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
      }
      for (const frame of this.framer.push(chunk)) {
        if (!this.ring.push(frame)) {
          this.logger.warn({ relayId: this.directive.relayId }, "relay source ring buffer full; dropped oldest frame");
        }
      }
    });
    proc.on("stderr", (line: string) => this.logger.debug({ line, relayId: this.directive.relayId }, "ffmpeg[relay]"));
    proc.on("exit", (code, signal) => {
      if (this.destroyed) return;
      if (code === 0) {
        // Clean EOF -- the relay legitimately finished. Stop the supervisor
        // before its own "exit" listener runs (ours was attached first, here
        // inside the factory it was given) so it doesn't respawn.
        this.supervisor.stop();
        if (!this.endedEmitted) {
          this.endedEmitted = true;
          this.emit("ended");
        }
        return;
      }
      this.logger.warn({ relayId: this.directive.relayId, code, signal }, "relay source ffmpeg exited unexpectedly; supervisor will retry");
    });
    proc.on("error", (err) => {
      this.logger.error({ err, relayId: this.directive.relayId }, "relay source ffmpeg failed to spawn");
    });

    return proc;
  }

  getFrame(): Float32Array | null {
    const frame = this.ring.shift();
    return frame ? bufferToFloat32Frame(frame) : null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.endedEmitted = true; // suppress a spurious "ended" from the async kill below
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.supervisor.stop();
    this.ring.clear();
  }
}
