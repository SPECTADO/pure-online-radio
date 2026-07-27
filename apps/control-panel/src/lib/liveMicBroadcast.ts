/**
 * Captures the manager's mic, applies the mic-volume slider client-side (a GainNode, before
 * encoding -- so the encoder never needs its own per-broadcaster gain control), encodes to
 * WebM/Opus via MediaRecorder, and streams chunks over a WebSocket to the encoder's
 * ws/liveMicServer.ts, which decodes them into the mixer's "mic" overlay slot (see
 * apps/encoder/src/sources/micSource.ts). One instance per on-air session.
 */
export class LiveMicBroadcast {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private recorder: MediaRecorder | null = null;
  private socket: WebSocket | null = null;

  /** Resolves once the mic is captured and the websocket is open and sending audio. Rejects
   * (and tears down anything partially started) if the device or socket can't be opened. */
  async start(params: { deviceId: string | undefined; volume: number; wsUrl: string }): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: params.deviceId ? { deviceId: { exact: params.deviceId } } : true,
      });

      const AudioContextCtor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) throw new Error("Web Audio API not supported in this browser");
      this.audioContext = new AudioContextCtor();

      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = params.volume;
      const destination = this.audioContext.createMediaStreamDestination();
      source.connect(this.gainNode).connect(destination);

      this.socket = new WebSocket(params.wsUrl);
      this.socket.binaryType = "arraybuffer";

      await new Promise<void>((resolve, reject) => {
        if (!this.socket) return reject(new Error("socket not created"));
        this.socket.onopen = () => resolve();
        this.socket.onerror = () => reject(new Error("couldn't connect to the encoder's live-mic socket"));
      });

      this.recorder = new MediaRecorder(destination.stream, { mimeType: "audio/webm;codecs=opus" });
      this.recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && this.socket?.readyState === WebSocket.OPEN) {
          void event.data.arrayBuffer().then((buf) => this.socket?.send(buf));
        }
      };
      this.recorder.start(250);
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  /** Live volume update -- no restart needed, just the GainNode's value. */
  setVolume(volume: number): void {
    if (this.gainNode) this.gainNode.gain.value = volume;
  }

  /** True once the socket has closed/errored on its own (e.g. the encoder dropped it) --
   * callers should treat this the same as an explicit stop. */
  get isClosed(): boolean {
    return this.socket !== null && this.socket.readyState !== WebSocket.OPEN && this.socket.readyState !== WebSocket.CONNECTING;
  }

  onClose(handler: () => void): void {
    if (this.socket) this.socket.onclose = handler;
  }

  stop(): void {
    this.recorder?.stop();
    this.recorder = null;
    this.socket?.close();
    this.socket = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.audioContext?.close();
    this.audioContext = null;
    this.gainNode = null;
  }
}
