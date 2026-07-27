import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { JingleDTO, MediaKind, SongDTO, VoiceTrackDTO } from "@spectado/shared-types";
import { apiClient } from "../lib/apiClient";
import { useAddToQueue } from "../lib/useAddToQueue";
import { formatDuration } from "../lib/format";
import { MediaKindBadge } from "./MediaKindBadge";

const JINGLES_KEY = ["library", "jingles"];
const VOICE_TRACKS_KEY = ["library", "voice-tracks"];
const MAX_SEARCH_RESULTS = 10;

interface QuickAddResult {
  mediaKind: MediaKind;
  id: string;
  title: string;
  subtitle: string | null;
  durationMs: number;
}

/** Search-and-add box covering songs, jingles, and voice tracks -- shared by
 * the Dashboard's "Quick Add" section and the Queue page. */
export function QuickAddSection() {
  const addToQueue = useAddToQueue();
  const [search, setSearch] = useState("");

  const songsQuery = useQuery({
    queryKey: ["library", "songs"],
    queryFn: () => apiClient.get<SongDTO[]>("/library/songs"),
  });
  const jinglesQuery = useQuery({
    queryKey: JINGLES_KEY,
    queryFn: () => apiClient.get<JingleDTO[]>("/library/jingles"),
  });
  const voiceTracksQuery = useQuery({
    queryKey: VOICE_TRACKS_KEY,
    queryFn: () => apiClient.get<VoiceTrackDTO[]>("/library/voice-tracks"),
  });

  const results = useMemo<QuickAddResult[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];

    const songResults: QuickAddResult[] = (songsQuery.data ?? [])
      .filter((song) => song.isActive && `${song.title} ${song.artist}`.toLowerCase().includes(q))
      .map((song) => ({ mediaKind: "SONG", id: song.id, title: song.title, subtitle: song.artist, durationMs: song.durationMs }));

    const jingleResults: QuickAddResult[] = (jinglesQuery.data ?? [])
      .filter((jingle) => jingle.isActive && jingle.title.toLowerCase().includes(q))
      .map((jingle) => ({ mediaKind: "JINGLE", id: jingle.id, title: jingle.title, subtitle: null, durationMs: jingle.durationMs }));

    const voiceTrackResults: QuickAddResult[] = (voiceTracksQuery.data ?? [])
      .filter((voiceTrack) => voiceTrack.isActive && voiceTrack.title.toLowerCase().includes(q))
      .map((voiceTrack) => ({
        mediaKind: "VOICE_TRACK",
        id: voiceTrack.id,
        title: voiceTrack.title,
        subtitle: null,
        durationMs: voiceTrack.durationMs,
      }));

    return [...songResults, ...jingleResults, ...voiceTrackResults].slice(0, MAX_SEARCH_RESULTS);
  }, [songsQuery.data, jinglesQuery.data, voiceTracksQuery.data, search]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Quick Add</h2>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search songs, jingles, and voice tracks by title…"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />

      {search.trim() !== "" && (
        <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-100">
          {results.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-500">No matching songs, jingles, or voice tracks.</p>
          )}
          {results.map((result) => (
            <div key={`${result.mediaKind}-${result.id}`} className="flex items-center justify-between gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <MediaKindBadge kind={result.mediaKind} />
                  <span className="truncate text-sm font-medium text-slate-900">{result.title}</span>
                </div>
                <div className="truncate text-xs text-slate-500">
                  {result.subtitle ? `${result.subtitle} · ` : ""}
                  {formatDuration(result.durationMs)}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={addToQueue.isPending}
                  onClick={() =>
                    addToQueue.mutate(
                      { mediaKind: result.mediaKind, mediaId: result.id, title: result.title },
                      { onSuccess: () => setSearch("") },
                    )
                  }
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Add to queue
                </button>
                <button
                  type="button"
                  disabled={addToQueue.isPending}
                  onClick={() =>
                    addToQueue.mutate(
                      { mediaKind: result.mediaKind, mediaId: result.id, title: result.title, playNext: true },
                      { onSuccess: () => setSearch("") },
                    )
                  }
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Play next
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
