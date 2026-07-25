interface PlayerControlsProps {
  playing: boolean;
  muted: boolean;
  volume: number;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
}

export function PlayerControls({
  playing,
  muted,
  volume,
  onTogglePlay,
  onToggleMute,
  onVolumeChange,
}: PlayerControlsProps) {
  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-3">
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg transition hover:scale-105 active:scale-95"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-slate-300 transition hover:border-slate-500 hover:text-white"
        >
          {muted ? <MutedIcon /> : <VolumeIcon />}
        </button>
      </div>

      <div className="flex w-full items-center gap-2">
        <span className="shrink-0 text-slate-500">
          <VolumeIcon small />
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          aria-label="Volume"
          className="h-1.5 w-full cursor-pointer accent-white"
        />
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="ml-1 h-7 w-7" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7" aria-hidden="true">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}

function VolumeIcon({ small }: { small?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={small ? "h-4 w-4" : "h-5 w-5"} aria-hidden="true">
      <path d="M3 10v4h4l5 5V5L7 10H3zM16.5 12a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12z" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
      <path d="M3 10v4h4l5 5V5L7 10H3zM19.8 12l2.2 2.2-1.4 1.4-2.2-2.2-2.2 2.2-1.4-1.4 2.2-2.2-2.2-2.2 1.4-1.4 2.2 2.2 2.2-2.2 1.4 1.4z" />
    </svg>
  );
}
