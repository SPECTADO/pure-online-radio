import { EventEmitter } from "node:events";
import type { JinglePlayCommand } from "@spectado/shared-types";
import type { GainEnvelope, Source } from "../core/types.js";
import { FRAME_BYTES } from "../core/types.js";
import { JingleGainEnvelope } from "../core/gainEnvelope.js";
import { bufferToFloat32Frame, PcmFramer } from "../core/pcmFraming.js";
import { RingBuffer } from "../core/ringBuffer.js";
import { FfmpegProcess } from "../process/ffmpegProcess.js";
import type { Logger } from "../util/logger.js";

const RING_BUFFER_CAPACITY_FRAMES = 250;

/**
 * REAL: same decode-to-ring-buffer approach as QueueSource, for the jingle
 * overlay slot. `buildGainEnvelope()` returns the fade in/out envelope (built
 * from `command.durationMs`/`fadeInMs`/`fadeOutMs`) that core/mixer.ts uses
 * both for this source's own fade AND to drive the ducking gain applied to
 * the primary bus.
 */
export class JingleSource extends EventEmitter implements Source {
  private readonly framer = new PcmFramer(FRAME_BYTES);
  private readonly ring = new RingBuffer<Buffer>(RING_BUFFER_CAPACITY_FRAMES);
  private readonly ffmpeg: FfmpegProcess;
  private ffmpegExited = false;
  private endedEmitted = false;
  private destroyed = false;

  constructor(
    private readonly command: JinglePlayCommand,
    private readonly logger: Logger,
  ) {
    super();
    this.ffmpeg = new FfmpegProcess(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "warning",
        // Read/decode at native (real-time) rate -- see queueSource.ts for why.
        "-re",
        "-i",
        command.url,
        "-f",
        "f32le",
        "-ar",
        "48000",
        "-ac",
        "2",
        "pipe:1",
      ],
      logger,
    );

    this.ffmpeg.on("stdout", (chunk: Buffer) => {
      if (this.destroyed) return;
      for (const frame of this.framer.push(chunk)) {
        if (!this.ring.push(frame)) {
          this.logger.warn({ jingleId: command.jingleId }, "jingle source ring buffer full; dropped oldest frame");
        }
      }
    });
    this.ffmpeg.on("stderr", (line: string) => this.logger.debug({ line, jingleId: command.jingleId }, "ffmpeg[jingle]"));
    this.ffmpeg.on("exit", (code, signal) => {
      this.ffmpegExited = true;
      if (!this.destroyed) {
        this.logger.info({ jingleId: command.jingleId, code, signal }, "jingle source ffmpeg process exited");
      }
    });
    this.ffmpeg.on("error", (err) => {
      this.logger.error({ err, jingleId: command.jingleId }, "jingle source ffmpeg failed to spawn");
      this.ffmpegExited = true;
    });
    this.ffmpeg.start();
  }

  buildGainEnvelope(): GainEnvelope {
    return new JingleGainEnvelope(this.command.durationMs, this.command.fadeInMs, this.command.fadeOutMs);
  }

  getFrame(): Float32Array | null {
    const frame = this.ring.shift();
    if (frame) {
      return bufferToFloat32Frame(frame);
    }
    if (this.ffmpegExited && !this.endedEmitted) {
      this.endedEmitted = true;
      this.emit("ended");
    }
    return null;
  }

  /** Hard-cuts playback (used for an explicit JingleStopCommand -- no
   * graceful fade-out on an explicit stop, see plan's noted simplification). */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.endedEmitted = true;
    this.ffmpeg.kill();
    this.ring.clear();
  }
}
