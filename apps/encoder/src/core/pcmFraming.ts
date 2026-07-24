/**
 * Reassembles arbitrary-sized Buffer chunks (e.g. stdout from an ffmpeg
 * decode child process, or a WebM/Opus decoder's PCM output) into exact,
 * fixed-size frames. ffmpeg/OS pipes deliver data in whatever chunk sizes the
 * kernel/process feel like - never assume a `data` event lines up with a
 * frame boundary.
 *
 * Not used by anything real yet in this pass (the filler source synthesizes
 * frames directly and never needs framing), but queueSource/relaySource/
 * micSource will all pipe decoded PCM through this once they're implemented.
 */
export class PcmFramer {
  private buffered: Buffer;

  constructor(private readonly frameBytes: number) {
    if (!Number.isInteger(frameBytes) || frameBytes <= 0) {
      throw new Error(`PcmFramer: frameBytes must be a positive integer, got ${frameBytes}`);
    }
    this.buffered = Buffer.alloc(0);
  }

  /**
   * Feed in a new chunk of raw PCM bytes. Returns zero or more complete,
   * exactly `frameBytes`-sized frames; any leftover partial frame is kept
   * internally and prepended to the next `push()` call.
   */
  push(chunk: Buffer): Buffer[] {
    this.buffered = this.buffered.length > 0 ? Buffer.concat([this.buffered, chunk]) : chunk;

    const frames: Buffer[] = [];
    let offset = 0;
    while (this.buffered.length - offset >= this.frameBytes) {
      frames.push(this.buffered.subarray(offset, offset + this.frameBytes));
      offset += this.frameBytes;
    }
    this.buffered = offset > 0 ? Buffer.from(this.buffered.subarray(offset)) : this.buffered;
    return frames;
  }

  /** Number of bytes currently buffered toward the next incomplete frame. */
  get pendingBytes(): number {
    return this.buffered.length;
  }

  /** Discards any partially-buffered frame (e.g. on a decode source restart). */
  reset(): void {
    this.buffered = Buffer.alloc(0);
  }
}
