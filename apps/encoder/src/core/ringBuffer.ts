/**
 * Small fixed-capacity ring buffer of frames. Generic over the frame type `T`
 * so it can hold `Buffer`s (raw PCM frames from a decode process) or
 * `Float32Array`s (already-parsed frames) interchangeably.
 *
 * Not wired into the real mixing path yet in this pass - queueSource and
 * relaySource will eventually decode ahead of real-time into one of these so
 * the mixer's 20ms tick never has to wait on ffmpeg/network I/O.
 *
 * Backpressure policy: when full, `push()` drops the OLDEST buffered frame to
 * make room for the newest one (favors staying close to real-time playback
 * over never losing a frame) and returns `false` so the caller can log/count
 * the drop.
 */
export class RingBuffer<T> {
  private readonly items: Array<T | undefined>;
  private head = 0; // index of the next item to shift()
  private count = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`RingBuffer: capacity must be a positive integer, got ${capacity}`);
    }
    this.items = new Array<T | undefined>(capacity);
  }

  /** Pushes an item onto the buffer. Returns false if it overwrote the oldest buffered item. */
  push(item: T): boolean {
    const tail = (this.head + this.count) % this.capacity;
    const wasFull = this.count === this.capacity;
    this.items[tail] = item;
    if (wasFull) {
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.count += 1;
    }
    return !wasFull;
  }

  /** Removes and returns the oldest item, or null if empty. */
  shift(): T | null {
    if (this.count === 0) return null;
    const item = this.items[this.head];
    this.items[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.count -= 1;
    return item ?? null;
  }

  get size(): number {
    return this.count;
  }

  get isFull(): boolean {
    return this.count === this.capacity;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
