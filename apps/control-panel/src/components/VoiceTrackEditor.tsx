import { useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "../lib/format";

const CANVAS_HEIGHT = 120;
const PEAK_BUCKETS = 800;
const HANDLE_HIT_PX = 8;
/** Below this, a drag is treated as a click-to-seek rather than a selection. */
const MIN_DRAG_PX = 4;

interface PeakData {
  min: Float32Array;
  max: Float32Array;
}

/** Same downsampling approach as WaveformEditor.tsx's computePeaks -- kept as a private copy
 * here rather than shared, since that component operates on a server file's decoded duration
 * only (no destructive editing), while this one re-runs it after every trim/cut on a fresh
 * in-memory AudioBuffer. */
function computePeaks(channelData: Float32Array): PeakData {
  const min = new Float32Array(PEAK_BUCKETS);
  const max = new Float32Array(PEAK_BUCKETS);
  const samplesPerBucket = Math.max(1, Math.floor(channelData.length / PEAK_BUCKETS));

  for (let bucket = 0; bucket < PEAK_BUCKETS; bucket++) {
    const start = bucket * samplesPerBucket;
    const end = Math.min(channelData.length, start + samplesPerBucket);
    let bucketMin = 0;
    let bucketMax = 0;
    for (let i = start; i < end; i++) {
      const sample = channelData[i] ?? 0;
      if (sample < bucketMin) bucketMin = sample;
      if (sample > bucketMax) bucketMax = sample;
    }
    min[bucket] = bucketMin;
    max[bucket] = bucketMax;
  }
  return { min, max };
}

/** A new AudioBuffer containing only [startMs, endMs) of `buffer`. */
function sliceBuffer(context: AudioContext, buffer: AudioBuffer, startMs: number, endMs: number): AudioBuffer {
  const startFrame = Math.max(0, Math.floor((startMs / 1000) * buffer.sampleRate));
  const endFrame = Math.min(buffer.length, Math.ceil((endMs / 1000) * buffer.sampleRate));
  const length = Math.max(1, endFrame - startFrame);
  const out = context.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    out.copyToChannel(buffer.getChannelData(ch).subarray(startFrame, startFrame + length), ch);
  }
  return out;
}

/** Ripple-deletes [startMs, endMs) -- everything before and after is concatenated together. */
function removeRange(context: AudioContext, buffer: AudioBuffer, startMs: number, endMs: number): AudioBuffer {
  const durationMs = (buffer.length / buffer.sampleRate) * 1000;
  const before = sliceBuffer(context, buffer, 0, startMs);
  const after = sliceBuffer(context, buffer, endMs, durationMs);
  const length = before.length + after.length;
  const out = context.createBuffer(buffer.numberOfChannels, Math.max(1, length), buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const channel = out.getChannelData(ch);
    channel.set(before.getChannelData(ch), 0);
    channel.set(after.getChannelData(ch), before.length);
  }
  return out;
}

export function VoiceTrackEditor({
  initialBuffer,
  onChange,
}: {
  initialBuffer: AudioBuffer;
  onChange: (buffer: AudioBuffer) => void;
}) {
  const contextRef = useRef<AudioContext | null>(null);
  if (!contextRef.current) contextRef.current = new AudioContext();

  const [history, setHistory] = useState<AudioBuffer[]>([initialBuffer]);
  // history is never emptied (pushHistory only appends, handleUndo only pops down to length 1).
  const buffer = history[history.length - 1]!;
  const durationMs = (buffer.length / buffer.sampleRate) * 1000;

  const [selection, setSelection] = useState<{ startMs: number; endMs: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<"new" | "start" | "end" | null>(null);
  const dragOriginRef = useRef(0);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackStartedAtRef = useRef(0);
  const playbackOffsetMsRef = useRef(0);

  const [canvasWidth, setCanvasWidth] = useState(600);
  const peaks = useMemo(() => computePeaks(buffer.getChannelData(0)), [buffer]);

  useEffect(() => {
    onChange(buffer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only when the buffer itself changes
  }, [buffer]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setCanvasWidth(Math.max(200, Math.floor(width)));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      sourceNodeRef.current?.stop();
      void contextRef.current?.close();
    };
  }, []);

  const timeToX = (ms: number) => (durationMs > 0 ? (ms / durationMs) * canvasWidth : 0);
  const xToTime = (x: number) => Math.min(durationMs, Math.max(0, (x / canvasWidth) * durationMs));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${CANVAS_HEIGHT}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, canvasWidth, CANVAS_HEIGHT);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvasWidth, CANVAS_HEIGHT);

    if (selection) {
      const x1 = timeToX(selection.startMs);
      const x2 = timeToX(selection.endMs);
      ctx.fillStyle = "rgba(147, 51, 234, 0.15)";
      ctx.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), CANVAS_HEIGHT);
    }

    const mid = CANVAS_HEIGHT / 2;
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 1;
    for (let i = 0; i < PEAK_BUCKETS; i++) {
      const x = (i / PEAK_BUCKETS) * canvasWidth;
      const yMax = mid - (peaks.max[i] ?? 0) * mid * 0.9;
      const yMin = mid - (peaks.min[i] ?? 0) * mid * 0.9;
      ctx.beginPath();
      ctx.moveTo(x, yMax);
      ctx.lineTo(x, yMin);
      ctx.stroke();
    }

    if (selection) {
      ctx.strokeStyle = "#9333ea";
      ctx.lineWidth = 2;
      for (const ms of [selection.startMs, selection.endMs]) {
        const x = timeToX(ms);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
      }
    }

    const playheadX = timeToX(currentTimeMs);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, CANVAS_HEIGHT);
    ctx.stroke();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timeToX/xToTime derive fresh from durationMs/canvasWidth each render
  }, [peaks, canvasWidth, durationMs, selection, currentTimeMs]);

  function handleAt(x: number): "start" | "end" | null {
    if (!selection) return null;
    if (Math.abs(timeToX(selection.startMs) - x) <= HANDLE_HIT_PX) return "start";
    if (Math.abs(timeToX(selection.endMs) - x) <= HANDLE_HIT_PX) return "end";
    return null;
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const hit = handleAt(x);
    draggingRef.current = hit ?? "new";
    dragOriginRef.current = x;
    if (!hit) setSelection({ startMs: xToTime(x), endMs: xToTime(x) });

    const onMove = (moveEvent: MouseEvent) => {
      const moveX = moveEvent.clientX - rect.left;
      const mode = draggingRef.current;
      if (mode === "start") {
        setSelection((sel) => (sel ? { startMs: Math.min(xToTime(moveX), sel.endMs), endMs: sel.endMs } : sel));
      } else if (mode === "end") {
        setSelection((sel) => (sel ? { startMs: sel.startMs, endMs: Math.max(xToTime(moveX), sel.startMs) } : sel));
      } else if (mode === "new") {
        const originMs = xToTime(dragOriginRef.current);
        const nowMs = xToTime(moveX);
        setSelection({ startMs: Math.min(originMs, nowMs), endMs: Math.max(originMs, nowMs) });
      }
    };
    const onUp = (upEvent: MouseEvent) => {
      const wasClick = draggingRef.current === "new" && Math.abs(upEvent.clientX - rect.left - dragOriginRef.current) < MIN_DRAG_PX;
      draggingRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (wasClick) {
        setSelection(null);
        seekTo(xToTime(upEvent.clientX - rect.left));
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function seekTo(ms: number): void {
    setCurrentTimeMs(ms);
    if (playing) {
      startPlayback(ms);
    } else {
      playbackOffsetMsRef.current = ms;
    }
  }

  function startPlayback(fromMs: number): void {
    const context = contextRef.current;
    if (!context) return;
    sourceNodeRef.current?.stop();

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      if (sourceNodeRef.current === source) {
        setPlaying(false);
        sourceNodeRef.current = null;
      }
    };
    source.start(0, fromMs / 1000);
    sourceNodeRef.current = source;
    playbackStartedAtRef.current = context.currentTime;
    playbackOffsetMsRef.current = fromMs;
    setPlaying(true);
  }

  function togglePlay(): void {
    if (playing) {
      sourceNodeRef.current?.stop();
      sourceNodeRef.current = null;
      setPlaying(false);
      return;
    }
    startPlayback(currentTimeMs >= durationMs ? 0 : currentTimeMs);
  }

  // Advances the playhead while playing -- AudioBufferSourceNode has no native timeupdate event.
  useEffect(() => {
    if (!playing) return;
    const context = contextRef.current;
    if (!context) return;
    const interval = setInterval(() => {
      const elapsedMs = (context.currentTime - playbackStartedAtRef.current) * 1000;
      setCurrentTimeMs(Math.min(durationMs, playbackOffsetMsRef.current + elapsedMs));
    }, 100);
    return () => clearInterval(interval);
  }, [playing, durationMs]);

  function pushHistory(next: AudioBuffer): void {
    setHistory((h) => [...h, next]);
    setSelection(null);
    setCurrentTimeMs(0);
    playbackOffsetMsRef.current = 0;
  }

  function handleTrim(): void {
    if (!selection || !contextRef.current) return;
    pushHistory(sliceBuffer(contextRef.current, buffer, selection.startMs, selection.endMs));
  }

  function handleRemove(): void {
    if (!selection || !contextRef.current) return;
    pushHistory(removeRange(contextRef.current, buffer, selection.startMs, selection.endMs));
  }

  function handleUndo(): void {
    if (history.length <= 1) return;
    setHistory((h) => h.slice(0, -1));
    setSelection(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-800"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <span className="text-xs tabular-nums text-slate-500">
          {formatDuration(currentTimeMs)} / {formatDuration(durationMs)}
        </span>
      </div>

      <div ref={containerRef} className="w-full">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          className="w-full cursor-crosshair rounded-md border border-slate-200"
          style={{ height: CANVAS_HEIGHT }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">
          {selection
            ? `Selection ${formatDuration(selection.startMs)}–${formatDuration(selection.endMs)}`
            : "Drag on the waveform to select a range."}
        </span>
        <button
          type="button"
          disabled={!selection}
          onClick={handleTrim}
          className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Trim to selection
        </button>
        <button
          type="button"
          disabled={!selection}
          onClick={handleRemove}
          className="rounded-md border border-red-200 px-3 py-1.5 font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Remove selection
        </button>
        <button
          type="button"
          disabled={history.length <= 1}
          onClick={handleUndo}
          className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Undo
        </button>
      </div>
    </div>
  );
}
