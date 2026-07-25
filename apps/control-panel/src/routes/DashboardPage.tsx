import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  JingleDTO,
  JingleEndedStatus,
  JingleStartedStatus,
  NowPlayingDTO,
  NowPlayingStatus,
  PlaybackMode,
  QueueEntryDTO,
} from "@spectado/shared-types";
import { NATS_SUBJECTS } from "@spectado/shared-types";
import { apiClient, apiUrl, ApiError } from "../lib/apiClient";
import { useNatsSubject } from "../lib/natsClient";
import { useCountdown } from "../lib/useCountdown";
import { withExpectedStartTimes } from "../lib/queueTiming";
import { formatDuration, formatTimeOfDay } from "../lib/format";
import { ProgressBar } from "../components/ProgressBar";

const NOW_PLAYING_KEY = ["now-playing"];
const QUEUE_KEY = ["queue"];
const UPCOMING_COUNT = 3;
const MAX_JINGLE_RESULTS = 10;

interface CurrentJingle {
  jingleId: string;
  title: string;
  durationMs: number;
  startedAt: string;
}

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

  const queueQuery = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: () => apiClient.get<QueueEntryDTO[]>("/queue"),
    retry: false,
    refetchInterval: 10_000,
  });
  useNatsSubject(NATS_SUBJECTS.control.queueUpdated, () => {
    queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
  });

  const [currentJingle, setCurrentJingle] = useState<CurrentJingle | null>(null);
  useNatsSubject<JingleStartedStatus>(NATS_SUBJECTS.encoderStatus.jingleStarted, (data) => {
    setCurrentJingle({ jingleId: data.jingleId, title: data.title, durationMs: data.durationMs, startedAt: data.ts });
  });
  useNatsSubject<JingleEndedStatus>(NATS_SUBJECTS.encoderStatus.jingleEnded, (data) => {
    setCurrentJingle((cur) => (cur?.jingleId === data.jingleId ? null : cur));
  });

  const nowPlayingCountdown = useCountdown(nowPlayingQuery.data?.startedAt ?? null, nowPlayingQuery.data?.durationMs ?? null);
  const jingleCountdown = useCountdown(currentJingle?.startedAt ?? null, currentJingle?.durationMs ?? null);

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

  const upNext = useMemo(
    () => withExpectedStartTimes(nowPlaying, queueQuery.data ?? []).slice(0, UPCOMING_COUNT),
    [nowPlaying, queueQuery.data],
  );

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
                  src={apiUrl(nowPlaying.coverArtUrl)}
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
              {nowPlayingCountdown && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1">
                    <ProgressBar progress={nowPlayingCountdown.progress} />
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">
                    -{formatDuration(nowPlayingCountdown.remainingMs)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Up Next
        </h2>
        {upNext.length === 0 ? (
          <p className="text-sm text-slate-500">The queue is empty.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upNext.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 text-sm">
                <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  {entry.mediaKind}
                </span>
                <span className="truncate text-slate-800">{entry.title}</span>
                {entry.artist && <span className="shrink-0 truncate text-slate-400">— {entry.artist}</span>}
                <span className="ml-auto shrink-0 tabular-nums text-slate-400">
                  {formatTimeOfDay(entry.expectedStartAt)}
                </span>
              </li>
            ))}
          </ul>
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

      <JingleWidget currentJingle={currentJingle} jingleCountdown={jingleCountdown ? formatDuration(jingleCountdown.remainingMs) : null} jingleProgress={jingleCountdown?.progress ?? null} />
    </div>
  );
}

function JingleWidget({
  currentJingle,
  jingleCountdown,
  jingleProgress,
}: {
  currentJingle: CurrentJingle | null;
  jingleCountdown: string | null;
  jingleProgress: number | null;
}) {
  const [search, setSearch] = useState("");
  const [jingleError, setJingleError] = useState<string | null>(null);

  const jinglesQuery = useQuery({
    queryKey: ["library", "jingles"],
    queryFn: () => apiClient.get<JingleDTO[]>("/library/jingles"),
  });

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return (jinglesQuery.data ?? [])
      .filter((jingle) => jingle.isActive && jingle.title.toLowerCase().includes(q))
      .slice(0, MAX_JINGLE_RESULTS);
  }, [jinglesQuery.data, search]);

  const playMutation = useMutation({
    mutationFn: (jingleId: string) => apiClient.post("/queue/jingle/play", { jingleId }),
    onError: (err) => setJingleError(describeError(err, "play jingle")),
  });
  const stopMutation = useMutation({
    mutationFn: () => apiClient.post("/queue/jingle/stop"),
    onError: (err) => setJingleError(describeError(err, "stop jingle")),
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Jingle
      </h2>

      {jingleError && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{jingleError}</div>
      )}

      {currentJingle && (
        <div className="mb-4 rounded-md border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900">{currentJingle.title}</div>
              <div className="text-xs text-slate-500">playing now</div>
            </div>
            <button
              type="button"
              disabled={stopMutation.isPending}
              onClick={() => stopMutation.mutate()}
              className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Stop
            </button>
          </div>
          {jingleProgress !== null && jingleCountdown && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1">
                <ProgressBar progress={jingleProgress} />
              </div>
              <span className="shrink-0 text-xs tabular-nums text-slate-500">-{jingleCountdown}</span>
            </div>
          )}
        </div>
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search jingles by title…"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />

      {search.trim() !== "" && (
        <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-100">
          {results.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">No matching jingles.</p>}
          {results.map((jingle) => (
            <div key={jingle.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">{jingle.title}</div>
                <div className="truncate text-xs text-slate-500">
                  {jingle.type} · {formatDuration(jingle.durationMs)}
                </div>
              </div>
              <button
                type="button"
                disabled={playMutation.isPending}
                onClick={() => playMutation.mutate(jingle.id)}
                className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Play
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function describeError(err: unknown, action: string): string {
  if (err instanceof ApiError && err.isNotImplemented) {
    return `The ${action} endpoint isn't implemented yet.`;
  }
  if (err instanceof Error) return err.message;
  return `Failed to ${action}.`;
}
