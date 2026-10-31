import * as fs from "node:fs";
import type { Logger } from "../util/logger.js";
import { FRAME_BYTES } from "./types.js";

/**
 * Owns the single, process-lifetime file descriptor for the master PCM FIFO
 * at PCM_FIFO_PATH (created by docker/entrypoint.sh via mkfifo before this
 * process starts).
 *
 * Critically, we open it with the 'r+' (O_RDWR) flag rather than 'w' (write
 * only). A FIFO opened write-only blocks the open() call until some other
 * process opens the read end, and - worse - a plain write-only writer gets
 * EOF/EPIPE the moment the reader (ffmpeg) exits, so we'd have to reopen the
 * FIFO on every ffmpeg restart and would drop frames/timing in the gap.
 * Opening 'r+' makes this process both a reader and a writer of the pipe
 * simultaneously from the kernel's point of view, so:
 *   - open() never blocks waiting for ffmpeg to show up first, and
 *   - the pipe never sees EOF even while ffmpeg (the other reader) is down,
 *     because *we* still hold a read end open too.
 * processSupervisor.ts restarts the ffmpeg side independently; this fd is
 * unaffected by that and is opened exactly once for the process lifetime.
 *
 * It's also opened O_NONBLOCK, which is just as critical: writes come from
 * the mixer tick on the main thread, and once the reader stops draining
 * (ffmpeg crashed/restarting, or stalled behind a dead gpac in LL mode) the
 * 64 KiB pipe buffer fills in ~170ms. A *blocking* write would then park the
 * whole event loop inside write(2) forever -- including the very setTimeout
 * that would respawn ffmpeg, since nothing else ever reads this pipe. With
 * O_NONBLOCK a full pipe is just EAGAIN and the frame is dropped.
 */
export class FifoWriter {
  private fd: number | null = null;
  /** Unwritten tail of a frame that only partly fit (a non-blocking write of
   * FRAME_BYTES > PIPE_BUF can be short). Flushed before the next frame so the
   * f32le stereo sample alignment of the stream is never broken. */
  private pending: Buffer | null = null;
  private droppedFrames = 0;
  private lastDropLogAt = 0;

  constructor(
    private readonly path: string,
    private readonly logger: Logger,
  ) {}

  /** Opens the FIFO (never blocks -- see the class comment). Call once at startup. */
  open(): void {
    if (this.fd !== null) return;
    this.fd = fs.openSync(this.path, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
    this.logger.info({ path: this.path }, "opened PCM FIFO for writing");
  }

  /**
   * Writes one frame (expected to be FRAME_BYTES long) to the FIFO, without
   * ever blocking. Best-effort: when the pipe is full (EAGAIN -- the normal
   * state while ffmpeg is restarting) or a write fails, the frame is dropped
   * whole rather than thrown, because losing 20ms of audio is always
   * preferable to crashing or stalling the mixer's tick loop. Drops are
   * logged rate-limited, not per frame.
   */
  writeFrame(buf: Buffer): void {
    if (this.fd === null) {
      throw new Error("FifoWriter.writeFrame called before open()");
    }
    if (buf.length !== FRAME_BYTES) {
      this.logger.warn({ expected: FRAME_BYTES, actual: buf.length }, "writeFrame called with unexpected frame size");
    }

    if (this.pending) {
      const written = this.tryWrite(this.pending);
      if (written < this.pending.length) {
        this.pending = this.pending.subarray(written);
        this.noteDroppedFrame();
        return;
      }
      this.pending = null;
    }

    const written = this.tryWrite(buf);
    if (written === 0) {
      this.noteDroppedFrame();
    } else if (written < buf.length) {
      // Copy: the caller may reuse its buffer (e.g. the shared silence frame).
      this.pending = Buffer.from(buf.subarray(written));
    }
  }

  /** Returns bytes written; 0 on a full pipe or a write error. */
  private tryWrite(buf: Buffer): number {
    try {
      return fs.writeSync(this.fd!, buf);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EAGAIN") {
        this.logger.warn({ err }, "PCM FIFO write failed; dropping frame");
      }
      return 0;
    }
  }

  private noteDroppedFrame(): void {
    this.droppedFrames++;
    const now = Date.now();
    if (now - this.lastDropLogAt >= 10_000) {
      this.logger.warn(
        { droppedFrames: this.droppedFrames },
        "PCM FIFO full (encoder ffmpeg not reading -- restarting?); dropping frames",
      );
      this.lastDropLogAt = now;
      this.droppedFrames = 0;
    }
  }

  close(): void {
    if (this.fd === null) return;
    try {
      fs.closeSync(this.fd);
    } catch (err) {
      this.logger.warn({ err }, "error closing PCM FIFO fd");
    } finally {
      this.fd = null;
      this.pending = null;
    }
  }
}
