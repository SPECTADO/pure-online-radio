import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NowPlayingDTO, NowPlayingStatus, PlaybackMode } from "@spectado/shared-types";
import { NATS_SUBJECTS } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { useNatsSubject } from "../lib/natsClient";

const NOW_PLAYING_KEY = ["now-playing"];

export function DashboardPage() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const nowPlayingQuery = useQuery({
    queryKey: NOW_PLAYING_KEY,
    queryFn: () => apiClient.get<NowPlayingDTO>("/public/now-playing"),
    refetchInterval: 10_000,
  });

  // Live push updates from the encoder (via the api's re-broadcast) take
  // precedence over the poll the moment one arrives.
  useNatsSubject<NowPlayingStatus>(NATS_SUBJECTS.encoderStatus.nowPlaying, (data) => {
    queryClient.setQueryData<NowPlayingDTO>(NOW_PLAYING_KEY, data);
  });

  const skipMutation = useMutation({
    mutationFn: () => apiClient.post("/queue/skip"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOW_PLAYING_KEY }),
    onError: (err) => setActionError(describeError(err, "skip")),
  });

  const startMutation = useMutation({
    mutationFn: () => apiClient.post("/queue/start"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOW_PLAYING_KEY }),
    onError: (err) => setActionError(describeError(err, "start")),
  });

  const modeMutation = useMutation({
    mutationFn: (mode: PlaybackMode) => apiClient.post("/queue/mode", { mode }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOW_PLAYING_KEY }),
    onError: (err) => setActionError(describeError(err, "change mode")),
  });

  const nowPlaying = nowPlayingQuery.data;
  const busy = skipMutation.isPending || startMutation.isPending || modeMutation.isPending;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Now Playing
        </h2>

        {nowPlayingQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {nowPlayingQuery.isError && (
          <p className="text-sm text-red-600">Could not load now-playing status.</p>
        )}

        {nowPlaying && (
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
              {nowPlaying.coverArtUrl ? (
                <img
                  src={nowPlaying.coverArtUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-2xl">&#9835;</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-medium text-slate-900">
                {nowPlaying.title ?? "Off air"}
              </div>
              <div className="truncate text-sm text-slate-500">
                {nowPlaying.artist ?? "—"}
                {nowPlaying.album ? ` · ${nowPlaying.album}` : ""}
              </div>
              <div className="mt-1 flex gap-2 text-xs text-slate-400">
                <span className="rounded bg-slate-100 px-2 py-0.5">{nowPlaying.type}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5">{nowPlaying.mode}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5">
                  {nowPlaying.isLive ? "on air" : "off air"}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Controls
        </h2>

        {actionError && (
          <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {actionError}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => skipMutation.mutate()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            Skip
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => startMutation.mutate()}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Start
          </button>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-slate-500">Mode</span>
            {(["LIVE", "MANUAL"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={busy}
                onClick={() => modeMutation.mutate(mode)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${
                  nowPlaying?.mode === mode
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function describeError(err: unknown, action: string): string {
  if (err instanceof ApiError && err.isNotImplemented) {
    return `The ${action} endpoint isn't implemented yet.`;
  }
  if (err instanceof Error) return err.message;
  return `Failed to ${action}.`;
}
