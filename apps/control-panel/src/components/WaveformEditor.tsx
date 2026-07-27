import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../lib/apiClient";

const CANVAS_HEIGHT = 120;
const PEAK_BUCKETS = 800;
/** Below this, a dragged region would invert (end before start) or vanish. */
const MIN_REGION_MS = 100;
/** Pixel tolerance for grabbing a handle -- generous enough for a mouse, canvas has no native hit-testing. */
const HANDLE_HIT_PX = 8;

type HandleId = "mixInStart" | "mixInEnd" | "mixOutStart" | "mixOutEnd";

interface PeakData {
  min: Float32Array;
  max: Float32Array;
}

interface WaveformEditorProps {
  songId: string;
  durationMs: number;
  mixInPointMs: number;
  mixInDurationMs: number;
  mixOutPointMs: number;
  mixOutDurationMs: number;
  onMixInChange: (pointMs: number, durationMs: number) => void;
  onMixOutChange: (pointMs: number, durationMs: number) => void;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Downsamples decoded channel data into PEAK_BUCKETS {min,max} pairs -- a
 * fixed-resolution waveform regardless of the source track's length/sample rate. */
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

export function WaveformEditor({
  songId,
  durationMs,
  mixInPointMs,
  mixInDurationMs,
  mixOutPointMs,
  mixOutDurationMs,
  onMixInChange,
  onMixOutChange,
}: WaveformEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const draggingRef = useRef<HandleId | null>(null);

  const [peaks, setPeaks] = useState<PeakData | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [hoveredHandle, setHoveredHandle] = useState<HandleId | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(600);

  const audioUrl = apiUrl(`/library/songs/${songId}/audio`);

  // Decode the full file client-side for the waveform -- separate from the
  // <audio> element's own streamed/Range-backed playback below.
  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    setDecodeError(null);
    setDecoding(true);

    (async () => {
      try {
        const res = await fetch(audioUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`fetch failed (${res.status})`);
        const arrayBuffer = await res.arrayBuffer();
        const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) throw new Error("Web Audio API not supported");
        const audioContext = new AudioContextCtor();
        try {
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          if (!cancelled) setPeaks(computePeaks(audioBuffer.getChannelData(0)));
        } finally {
          void audioContext.close();
        }
      } catch (err) {
        if (!cancelled) setDecodeError(err instanceof Error ? err.message : "Couldn't decode audio");
      } finally {
        if (!cancelled) setDecoding(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [audioUrl]);

  // Track the container's width so the canvas fills it responsively.
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

  const timeToX = (ms: number) => (durationMs > 0 ? (ms / durationMs) * canvasWidth : 0);
  const xToTime = (x: number) => (canvasWidth > 0 ? (x / canvasWidth) * durationMs : 0);

  const handles: Record<HandleId, number> = {
    mixInStart: mixInPointMs,
    mixInEnd: mixInPointMs + mixInDurationMs,
    mixOutStart: mixOutPointMs,
    mixOutEnd: mixOutPointMs + mixOutDurationMs,
  };

  // Redraw whenever anything visual changes -- peaks, region edits, or the playhead.
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

    // Mix-in / mix-out shaded regions, behind the waveform.
    const mixInX = timeToX(mixInPointMs);
    const mixInEndX = timeToX(mixInPointMs + mixInDurationMs);
    ctx.fillStyle = "rgba(37, 99, 235, 0.12)";
    ctx.fillRect(mixInX, 0, mixInEndX - mixInX, CANVAS_HEIGHT);

    const mixOutX = timeToX(mixOutPointMs);
    const mixOutEndX = timeToX(mixOutPointMs + mixOutDurationMs);
    ctx.fillStyle = "rgba(234, 88, 12, 0.12)";
    ctx.fillRect(mixOutX, 0, mixOutEndX - mixOutX, CANVAS_HEIGHT);

    // Waveform peaks.
    const mid = CANVAS_HEIGHT / 2;
    if (peaks) {
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
    } else {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "12px sans-serif";
      ctx.fillText(decodeError ? "Waveform unavailable" : "Decoding waveform…", 8, mid + 4);
    }

    // Handles.
    const handleColor: Record<HandleId, string> = {
      mixInStart: "#2563eb",
      mixInEnd: "#2563eb",
      mixOutStart: "#ea580c",
      mixOutEnd: "#ea580c",
    };
    for (const id of Object.keys(handles) as HandleId[]) {
      const x = timeToX(handles[id]);
      const active = hoveredHandle === id || draggingRef.current === id;
      ctx.strokeStyle = handleColor[id];
      ctx.lineWidth = active ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
      ctx.fillStyle = handleColor[id];
      ctx.beginPath();
      ctx.arc(x, 8, active ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Playhead.
    const playheadX = timeToX(currentTimeMs);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, CANVAS_HEIGHT);
    ctx.stroke();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handles is derived fresh every render from the props below
  }, [peaks, decodeError, canvasWidth, mixInPointMs, mixInDurationMs, mixOutPointMs, mixOutDurationMs, currentTimeMs, hoveredHandle]);

  function handleAt(x: number): HandleId | null {
    let closest: HandleId | null = null;
    let closestDistance = HANDLE_HIT_PX;
    for (const id of Object.keys(handles) as HandleId[]) {
      const distance = Math.abs(timeToX(handles[id]) - x);
      if (distance <= closestDistance) {
        closest = id;
        closestDistance = distance;
      }
    }
    return closest;
  }

  function updateHandle(id: HandleId, timeMs: number): void {
    const clamped = Math.min(Math.max(timeMs, 0), durationMs);
    switch (id) {
      case "mixInStart": {
        const end = mixInPointMs + mixInDurationMs;
        const start = Math.min(clamped, end - MIN_REGION_MS);
        onMixInChange(Math.max(0, start), end - Math.max(0, start));
        break;
      }
      case "mixInEnd": {
        const end = Math.max(clamped, mixInPointMs + MIN_REGION_MS);
        onMixInChange(mixInPointMs, end - mixInPointMs);
        break;
      }
      case "mixOutStart": {
        const end = mixOutPointMs + mixOutDurationMs;
        const start = Math.min(clamped, end - MIN_REGION_MS);
        onMixOutChange(Math.max(0, start), end - Math.max(0, start));
        break;
      }
      case "mixOutEnd": {
        const end = Math.min(Math.max(clamped, mixOutPointMs + MIN_REGION_MS), durationMs);
        onMixOutChange(mixOutPointMs, end - mixOutPointMs);
        break;
      }
    }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const hit = handleAt(x);

    if (hit) {
      draggingRef.current = hit;
      const onMove = (moveEvent: MouseEvent) => {
        const moveX = moveEvent.clientX - rect.left;
        updateHandle(hit, xToTime(moveX));
      };
      const onUp = () => {
        draggingRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return;
    }

    // Clicked elsewhere on the waveform -- seek playback there.
    const audio = audioRef.current;
    if (audio) audio.currentTime = xToTime(x) / 1000;
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (draggingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredHandle(handleAt(e.clientX - rect.left));
  }

  function togglePlay(): void {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrentTimeMs(e.currentTarget.currentTime * 1000)}
      />

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
          {formatTime(currentTimeMs)} / {formatTime(durationMs)}
        </span>
        {decoding && <span className="text-xs text-slate-400">Decoding waveform…</span>}
      </div>

      <div ref={containerRef} className="w-full">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredHandle(null)}
          className="w-full cursor-pointer rounded-md border border-slate-200"
          style={{ height: CANVAS_HEIGHT }}
        />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-600" /> Mix-in{" "}
          {formatTime(mixInPointMs)}–{formatTime(mixInPointMs + mixInDurationMs)}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-orange-600" /> Mix-out{" "}
          {formatTime(mixOutPointMs)}–{formatTime(mixOutPointMs + mixOutDurationMs)}
        </span>
        <span>Drag a handle to adjust, click elsewhere to seek.</span>
      </div>
    </div>
  );
}
