import { EventEmitter } from "node:events";
import type { TrackDirectiveDTO } from "@spectado/shared-types";
import type { Source } from "../core/types.js";
import { FRAME_BYTES } from "../core/types.js";
import { bufferToFloat32Frame, PcmFramer } from "../core/pcmFraming.js";
import { RingBuffer } from "../core/ringBuffer.js";
import { FfmpegProcess } from "../process/ffmpegProcess.js";
import type { Logger } from "../util/logger.js";

/** ~5s of buffered audio at 20ms/frame -- headroom against decode I/O jitter. */
const RING_BUFFER_CAPACITY_FRAMES = 250;

/**
 * REAL: decodes `directive.url` (a short-lived presigned MinIO GET url) via a
 * spawned ffmpeg child into raw f32le/48000/stereo PCM, frames it into exact
 * 20ms chunks (PcmFramer), and buffers a few seconds ahead of real-time in a
 * RingBuffer so mixer tick jitter / decode I/O hiccups never starve the bus.
 *
 * Emits `"ended"` exactly once, once ffmpeg has exited AND the ring buffer
 * has fully drained -- the signal queueController uses to advance to the next
 * queue item. `destroy()` hard-kills playback (used for an explicit "skip";
 * no graceful fade needed there, unlike the jingle overlay).
 */
export class QueueSource extends EventEmitter implements Source {
  private readonly framer = new PcmFramer(FRAME_BYTES);
  private readonly ring = new RingBuffer<Buffer>(RING_BUFFER_CAPACITY_FRAMES);
  private readonly ffmpeg: FfmpegProcess;
  private ffmpegExited = false;
  private endedEmitted = false;
  private destroyed = false;

  constructor(
    private readonly directive: TrackDirectiveDTO,
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
        // Read/decode at native (real-time) rate -- without this ffmpeg
        // decodes a local/fast-network file as fast as the CPU allows (often
        // 10-100x real-time), which floods the ring buffer and drops nearly
        // the whole track before the mixer's 20ms tick can consume it.
        "-re",
        "-i",
        directive.url,
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
          this.logger.warn({ mediaId: directive.mediaId }, "queue source ring buffer full; dropped oldest frame");
        }
      }
    });
    this.ffmpeg.on("stderr", (line: string) => this.logger.debug({ line, mediaId: directive.mediaId }, "ffmpeg[queue]"));
    this.ffmpeg.on("exit", (code, signal) => {
      this.ffmpegExited = true;
      if (!this.destroyed) {
        this.logger.info({ mediaId: directive.mediaId, code, signal }, "queue source ffmpeg process exited");
      }
    });
    this.ffmpeg.on("error", (err) => {
      this.logger.error({ err, mediaId: directive.mediaId }, "queue source ffmpeg failed to spawn");
      this.ffmpegExited = true;
    });
    this.ffmpeg.start();
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

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.endedEmitted = true; // suppress a spurious "ended" from the async kill below
    this.ffmpeg.kill();
    this.ring.clear();
  }
}
