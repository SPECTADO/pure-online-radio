import { EventEmitter } from "node:events";
import type { Source } from "../core/types.js";
import { FRAME_BYTES } from "../core/types.js";
import { bufferToFloat32Frame, PcmFramer } from "../core/pcmFraming.js";
import { RingBuffer } from "../core/ringBuffer.js";
import { FfmpegProcess } from "../process/ffmpegProcess.js";
import type { Logger } from "../util/logger.js";

const RING_BUFFER_CAPACITY_FRAMES = 250;

/**
 * REAL: same decode-to-ring-buffer approach as JingleSource/RelaySource, but fed over stdin
 * (from ws/liveMicServer.ts's incoming WebM/Opus binary WS frames) instead of a URL -- ffmpeg
 * decodes in real time as chunks arrive rather than reading a whole file/stream itself
 * (`FfmpegProcess.stdin` exists specifically for this). No `-re` flag (unlike queue/jingle/relay
 * sources): the browser is already sending audio in real time, so pacing is the WS sender's job,
 * not ffmpeg's.
 */
export class MicSource extends EventEmitter implements Source {
  private readonly framer = new PcmFramer(FRAME_BYTES);
  private readonly ring = new RingBuffer<Buffer>(RING_BUFFER_CAPACITY_FRAMES);
  private readonly ffmpeg: FfmpegProcess;
  private destroyed = false;

  constructor(
    private readonly sessionId: string,
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
        "-f",
        "webm",
        "-i",
        "pipe:0",
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
          this.logger.warn({ sessionId }, "mic source ring buffer full; dropped oldest frame");
        }
      }
    });
    this.ffmpeg.on("stderr", (line: string) => this.logger.debug({ line, sessionId }, "ffmpeg[mic]"));
    this.ffmpeg.on("exit", (code, signal) => {
      if (!this.destroyed) {
        this.logger.warn({ sessionId, code, signal }, "mic source ffmpeg process exited unexpectedly");
        this.emit("failed");
      }
    });
    this.ffmpeg.on("error", (err) => {
      this.logger.error({ err, sessionId }, "mic source ffmpeg failed to spawn");
      this.emit("failed");
    });
    this.ffmpeg.start();
  }

  /** Feeds one incoming WS binary frame (raw WebM/Opus bytes) to the decode process. */
  write(chunk: Buffer): void {
    if (this.destroyed) return;
    this.ffmpeg.stdin?.write(chunk);
  }

  getFrame(): Float32Array | null {
    const frame = this.ring.shift();
    return frame ? bufferToFloat32Frame(frame) : null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ffmpeg.kill();
    this.ring.clear();
  }
}
