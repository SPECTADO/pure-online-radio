/**
 * Captures the manager's mic, applies the mic-volume slider client-side (a GainNode, before
 * encoding -- so the encoder never needs its own per-broadcaster gain control), encodes it via
 * MediaRecorder (WebM/Opus where supported, see `pickRecorderMimeType`), and streams chunks over a
 * WebSocket to the encoder's ws/liveMicServer.ts, which decodes them into the mixer's "mic"
 * overlay slot (see apps/encoder/src/sources/micSource.ts). One instance per on-air session.
 */

/** MediaRecorder container/codec preference, best first. The encoder's decode ffmpeg autodetects
 * the container (no hard-coded `-f`), so any of these works server-side: Chrome/Edge/Firefox all
 * take the first entry; Safari versions without WebM recording fall through to (fragmented) MP4. */
const RECORDER_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

/** How often MediaRecorder hands over a chunk. The encoder's MicSource jitter buffer is sized
 * around this (it has to absorb one whole chunk interval plus network jitter). */
const RECORDER_TIMESLICE_MS = 250;

/**
 * Returns a human-readable reason live-mic capture can't work in this page, or null if it can.
 * Checked *before* asking the api for a session, so an impossible broadcast never mounts a
 * (music-ducking) mic slot on the encoder. The common real-world case: the panel opened over plain
 * `http://` from anything other than localhost (e.g. `http://192.168.x.x:8000/manage/` from
 * another machine) -- browsers only expose `navigator.mediaDevices` in a secure context.
 */
export function liveMicUnsupportedReason(): string | null {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return "The browser only allows microphone access on HTTPS (or http://localhost). Open the control panel over HTTPS to go on air.";
  }
  if (typeof MediaRecorder === "undefined") return "This browser can't record audio (no MediaRecorder support).";
  if (!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)) {
    return "This browser doesn't support the Web Audio API.";
  }
  return null;
}

function pickRecorderMimeType(): string | undefined {
  return RECORDER_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Absolute ws(s):// URL for the session's relative `wsPath`, against the page's own origin --
 * so it is right however the panel was reached (LAN IP, domain, HTTPS -> wss, the Vite dev
 * server's /live-mic proxy), instead of trusting a server-configured base URL. */
export function liveMicSocketUrl(wsPath: string): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}${wsPath}`;
}

export class LiveMicBroadcast {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private recorder: MediaRecorder | null = null;
  private socket: WebSocket | null = null;
  private closeHandler: ((reason: string | null) => void) | null = null;
  private stopped = false;

  /** Resolves once the mic is captured and the websocket is open and sending audio. Rejects
   * (and tears down anything partially started) if the device or socket can't be opened. */
  async start(params: { deviceId: string | undefined; volume: number; wsUrl: string }): Promise<void> {
    try {
      const unsupported = liveMicUnsupportedReason();
      if (unsupported) throw new Error(unsupported);

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(params.deviceId ? { deviceId: { exact: params.deviceId } } : {}),
          // Broadcast mic, not a video call: the browser's default WebRTC voice processing
          // (noise suppression especially) treats anything steady as noise and pulls it down to
          // near-silence within ~1s -- verified directly with a steady test tone, which vanished
          // from the on-air stream after ~1.1s with these left at their defaults -- and AGC
          // "pumps" against the ducked music bed. Level control is the mic-volume slider's job.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const AudioContextCtor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioContextCtor();
      // Created after several awaits (the session POST, getUserMedia) -- outside the click's
      // user-activation window in stricter browsers, where it would start "suspended" and the
      // MediaStreamDestination below would only ever emit silence. A no-op if already running.
      if (this.audioContext.state === "suspended") await this.audioContext.resume();

      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = params.volume;
      const destination = this.audioContext.createMediaStreamDestination();
      source.connect(this.gainNode).connect(destination);

      const socket = new WebSocket(params.wsUrl);
      this.socket = socket;

      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error("couldn't connect to the encoder's live-mic socket"));
        socket.onclose = (event) =>
          reject(new Error(`the encoder refused the live-mic socket (${event.code}${event.reason ? ` ${event.reason}` : ""})`));
      });
      socket.onerror = null;
      socket.onclose = (event) => {
        if (this.stopped) return;
        this.notifyClosed(`the live-mic connection to the encoder closed (${event.code}${event.reason ? ` ${event.reason}` : ""})`);
      };

      // The mic going away underneath us (unplugged, permission revoked) would otherwise keep
      // the recorder happily encoding silence while the station stays ducked -- end the broadcast.
      for (const track of this.stream.getAudioTracks()) {
        track.onended = () => this.notifyClosed("the microphone stopped delivering audio (disconnected?)");
      }

      const mimeType = pickRecorderMimeType();
      this.recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
      this.recorder.ondataavailable = (event) => {
        // Send the Blob itself: WebSocket.send queues Blobs in call order, whereas the previous
        // `event.data.arrayBuffer().then(send)` let each chunk's send depend on its own async
        // read resolving -- the container stream can't tolerate a reordered chunk.
        if (event.data.size > 0 && this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(event.data);
        }
      };
      this.recorder.onerror = () => this.notifyClosed("the browser's audio recorder failed");
      this.recorder.start(RECORDER_TIMESLICE_MS);
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  /** Live volume update -- no restart needed, just the GainNode's value. */
  setVolume(volume: number): void {
    if (this.gainNode) this.gainNode.gain.value = volume;
  }

  /** Called at most once, when the broadcast ends on its own (encoder dropped the socket, mic
   * unplugged, recorder error) -- NOT after an explicit `stop()`. Callers should treat it the same
   * as the manager going off air, and surface `reason`. */
  onClose(handler: (reason: string | null) => void): void {
    this.closeHandler = handler;
  }

  stop(): void {
    this.stopped = true;
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
    this.socket?.close();
    this.socket = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.audioContext?.close();
    this.audioContext = null;
    this.gainNode = null;
  }

  private notifyClosed(reason: string): void {
    if (this.stopped) return;
    const handler = this.closeHandler;
    this.stop();
    handler?.(reason);
  }
}
