import { apiUrl } from "../lib/apiClient";
import { useAudioPreviewStore } from "../lib/audioPreviewStore";

/** Small play/pause toggle used in the songs/jingles/ads library tables.
 * `path` is the API-relative audio-streaming route for that item (e.g.
 * `/library/songs/{id}/audio`). Only one preview plays at a time app-wide --
 * starting another one stops whichever was playing. */
export function PreviewButton({ id, path }: { id: string; path: string }) {
  const playingId = useAudioPreviewStore((s) => s.playingId);
  const play = useAudioPreviewStore((s) => s.play);
  const stop = useAudioPreviewStore((s) => s.stop);
  const isPlaying = playingId === id;

  return (
    <button
      type="button"
      onClick={() => (isPlaying ? stop() : play(id, apiUrl(path)))}
      aria-label={isPlaying ? "Pause preview" : "Play preview"}
      title={isPlaying ? "Pause preview" : "Play preview"}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs transition-colors ${
        isPlaying
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {isPlaying ? "❚❚" : "▶"}
    </button>
  );
}
