import { EventEmitter } from "node:events";
import type { Source } from "../core/types.js";
import { FRAME_BYTES, FRAME_MS } from "../core/types.js";
import { bufferToFloat32Frame, PcmFramer } from "../core/pcmFraming.js";
import { RingBuffer } from "../core/ringBuffer.js";
import { FfmpegProcess } from "../process/ffmpegProcess.js";
import type { Logger } from "../util/logger.js";

const RING_BUFFER_CAPACITY_FRAMES = 400; // 8s hard ceiling; the jitter buffer below trims well before this

/**
 * Jitter buffer. The browser's MediaRecorder hands over audio in ~250-320ms bursts (its
 * timeslice, see liveMicBroadcast.ts), the network adds its own jitter on top, and the mixer pulls
 * exactly one 20ms frame per tick -- so frames must not be handed out the moment the first ones
 * are decoded. Without this (the original implementation), the ring ran dry between bursts --
 * measured: 7 gaps of 20-120ms in 25s when replaying a real Chrome MediaRecorder capture with
 * 100-450ms delivery jitter (0 with this buffer) -- and every stall's backlog then stayed queued
 * forever, permanently adding that much latency. Now:
 *  - nothing is emitted until the target depth is buffered (and again after any underrun -- one
 *    clean re-buffer instead of a stutter of single-frame gaps). The target starts at
 *    JITTER_TARGET_MIN_FRAMES and grows by JITTER_TARGET_STEP_FRAMES per underrun (up to
 *    JITTER_TARGET_MAX_FRAMES), so a connection that keeps under-running settles at a depth that
 *    actually covers its jitter instead of gapping forever at a fixed one;
 *  - if the backlog ever exceeds JITTER_MAX_FRAMES (a burst after a long network stall, or the
 *    browser's audio clock running slightly fast relative to the mixer's), the oldest frames are
 *    dropped back down to the target, so latency can't creep up over a long broadcast.
 */
//
// Sized generously on purpose: listeners hear the station through HLS, which is already many
// seconds behind real time, so ~1s of extra mic latency is inaudible to everyone -- whereas a
// gap is not. 400ms was tried first and still under-ran right after the initial prebuffer when
// replaying a real browser capture with 100-450ms delivery jitter.
const JITTER_TARGET_MIN_FRAMES = Math.round(1000 / FRAME_MS);
const JITTER_TARGET_STEP_FRAMES = Math.round(250 / FRAME_MS);
const JITTER_TARGET_MAX_FRAMES = Math.round(3000 / FRAME_MS);
const JITTER_MAX_FRAMES = Math.round(5000 / FRAME_MS);
/** Safety bound on `drain()` -- the most a full jitter buffer plus ffmpeg's flush can hold. */
const MAX_DRAIN_MS = 6000;

/**
 * REAL: same decode-to-ring-buffer approach as JingleSource/RelaySource, but fed over stdin
 * (from ws/liveMicServer.ts's incoming binary WS frames) instead of a URL -- ffmpeg decodes in
 * real time as chunks arrive rather than reading a whole file/stream itself (`FfmpegProcess.stdin`
 * exists specifically for this). No `-re` flag (unlike queue/jingle/relay sources): the browser is
 * already sending audio in real time, so pacing is the WS sender's job (smoothed by the jitter
 * buffer above), not ffmpeg's. No `-f` either: the container is autodetected, since which one
 * MediaRecorder produces depends on the browser (WebM/Opus in Chrome/Edge/Firefox, fragmented MP4
 * in Safari versions without WebM recording) -- a hard-coded `-f webm` rejects the latter outright.
 */
export class MicSource extends EventEmitter implements Source {
  private readonly framer = new PcmFramer(FRAME_BYTES);
  private readonly ring = new RingBuffer<Buffer>(RING_BUFFER_CAPACITY_FRAMES);
  private readonly ffmpeg: FfmpegProcess;
  private destroyed = false;
  private buffering = true;
  private ffmpegExited = false;
  private onDrained: (() => void) | null = null;
  private drainTimer: NodeJS.Timeout | null = null;
  private targetFrames = JITTER_TARGET_MIN_FRAMES;
  private firstWriteAtMs: number | null = null;
  private loggedFirstAudio = false;
  private readonly stats = { framesOut: 0, underruns: 0, framesTrimmed: 0, framesOverflowed: 0 };

  constructor(
    private readonly sessionId: string,
    private readonly logger: Logger,
  ) {
    super();
    this.ffmpeg = new FfmpegProcess(
      "ffmpeg",
      ["-nostdin", "-hide_banner", "-loglevel", "warning", "-i", "pipe:0", "-f", "f32le", "-ar", "48000", "-ac", "2", "pipe:1"],
      logger,
    );

    this.ffmpeg.on("stdout", (chunk: Buffer) => {
      if (this.destroyed) return;
      if (!this.loggedFirstAudio) {
        this.loggedFirstAudio = true;
        const decodeDelayMs = this.firstWriteAtMs === null ? null : Date.now() - this.firstWriteAtMs;
        this.logger.info({ sessionId, decodeDelayMs }, "mic source: first audio decoded");
      }
      for (const frame of this.framer.push(chunk)) {
        if (!this.ring.push(frame)) this.stats.framesOverflowed += 1;
      }
    });
    // -loglevel warning: anything ffmpeg prints here is a real decode problem worth seeing --
    // except while draining, where "File ended prematurely" is just drain() closing stdin.
    this.ffmpeg.on("stderr", (line: string) => {
      if (this.onDrained) this.logger.debug({ line, sessionId }, "ffmpeg[mic] (draining)");
      else this.logger.warn({ line, sessionId }, "ffmpeg[mic]");
    });
    // "close", not "exit": only then is every decoded stdout chunk guaranteed to be in the ring.
    this.ffmpeg.on("close", () => {
      this.ffmpegExited = true;
      if (this.onDrained && this.ring.isEmpty) this.finishDrain();
    });
    this.ffmpeg.on("exit", (code, signal) => {
      if (this.onDrained) return; // expected: drain() closed stdin
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

    // Without a listener, a write racing ffmpeg's death (it rejected the input, crashed, or was
    // killed) surfaces as an unhandled stream 'error' (EPIPE) -- an uncaughtException that took
    // the WHOLE encoder process down, ending the station's stream, not just the mic session
    // (reproduced by sending a non-audio payload over an authorized socket). The process's own
    // 'exit' handler above is what ends the session; this only has to keep the error contained.
    this.ffmpeg.stdin?.on("error", (err) => {
      if (this.destroyed || this.onDrained) return;
      this.logger.warn({ err, sessionId }, "mic source ffmpeg stdin error");
      this.emit("failed");
    });
  }

  /** Feeds one incoming WS binary frame (raw container bytes from MediaRecorder) to the decode process. */
  write(chunk: Buffer): void {
    if (this.destroyed || this.onDrained) return;
    const stdin = this.ffmpeg.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return;
    if (this.firstWriteAtMs === null) this.firstWriteAtMs = Date.now();
    stdin.write(chunk);
  }

  getFrame(): Float32Array | null {
    if (this.onDrained) {
      const frame = this.ring.shift();
      if (frame) return bufferToFloat32Frame(frame);
      if (this.ffmpegExited) this.finishDrain();
      return null;
    }
    if (this.buffering) {
      if (this.ring.size < this.targetFrames) return null;
      this.buffering = false;
    }
    if (this.ring.size > JITTER_MAX_FRAMES) {
      while (this.ring.size > this.targetFrames) {
        this.ring.shift();
        this.stats.framesTrimmed += 1;
      }
      this.logger.info({ sessionId: this.sessionId }, "mic source: backlog over jitter max, trimmed to target latency");
    }
    const frame = this.ring.shift();
    if (!frame) {
      this.buffering = true;
      this.stats.underruns += 1;
      this.targetFrames = Math.min(JITTER_TARGET_MAX_FRAMES, this.targetFrames + JITTER_TARGET_STEP_FRAMES);
      this.logger.debug({ sessionId: this.sessionId, targetMs: this.targetFrames * FRAME_MS }, "mic source underrun; re-buffering");
      return null;
    }
    this.stats.framesOut += 1;
    return bufferToFloat32Frame(frame);
  }

  /**
   * Ends the session gracefully: stops accepting input, lets ffmpeg decode/flush what it already
   * has, and keeps handing out frames until the jitter buffer is empty -- then calls `onDrained`
   * (the caller unmounts and destroys). Without this, going off air would discard the ~1s the
   * jitter buffer is deliberately holding, i.e. cut off the manager's last words.
   */
  drain(onDrained: () => void): void {
    if (this.destroyed) {
      onDrained();
      return;
    }
    this.onDrained = onDrained;
    this.buffering = false;
    this.drainTimer = setTimeout(() => this.finishDrain(), MAX_DRAIN_MS);
    if (this.ffmpegExited) {
      if (this.ring.isEmpty) this.finishDrain();
    } else {
      this.ffmpeg.stdin?.end();
    }
  }

  private finishDrain(): void {
    const callback = this.onDrained;
    if (!callback) return;
    this.onDrained = null;
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = null;
    callback();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.onDrained = null;
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.logger.info(
      { sessionId: this.sessionId, ...this.stats, finalJitterTargetMs: this.targetFrames * FRAME_MS },
      "mic source stopped",
    );
    this.ffmpeg.stdin?.destroy();
    this.ffmpeg.kill();
    this.ring.clear();
  }
}
