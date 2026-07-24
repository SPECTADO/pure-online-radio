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
 */
export class FifoWriter {
  private fd: number | null = null;

  constructor(
    private readonly path: string,
    private readonly logger: Logger,
  ) {}

  /** Opens (and if necessary blocks briefly for) the FIFO. Call once at startup. */
  open(): void {
    if (this.fd !== null) return;
    this.fd = fs.openSync(this.path, "r+");
    this.logger.info({ path: this.path }, "opened PCM FIFO for writing");
  }

  /**
   * Writes exactly one frame (expected to be FRAME_BYTES long) to the FIFO.
   * Synchronous and best-effort: a write failure (e.g. EAGAIN if the pipe's
   * kernel buffer is momentarily full because ffmpeg is mid-restart, or
   * EPIPE in some transient state) is logged and swallowed rather than
   * thrown, because losing 20ms of audio is always preferable to crashing
   * the mixer's tick loop.
   */
  writeFrame(buf: Buffer): void {
    if (this.fd === null) {
      throw new Error("FifoWriter.writeFrame called before open()");
    }
    if (buf.length !== FRAME_BYTES) {
      this.logger.warn({ expected: FRAME_BYTES, actual: buf.length }, "writeFrame called with unexpected frame size");
    }
    try {
      fs.writeSync(this.fd, buf);
    } catch (err) {
      this.logger.warn({ err }, "PCM FIFO write failed; dropping frame");
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
    }
  }
}
