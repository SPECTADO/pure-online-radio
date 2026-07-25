import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  JingleDTO,
  JingleEndedStatus,
  JingleStartedStatus,
  LiveMicSessionDTO,
  MediaKind,
  NowPlayingDTO,
  NowPlayingStatus,
  PlaybackMode,
  QueueEntryDTO,
  ScratchPadDTO,
  SongDTO,
} from "@spectado/shared-types";
import { NATS_SUBJECTS } from "@spectado/shared-types";
import { apiClient, apiUrl, ApiError } from "../lib/apiClient";
import { useNatsSubject } from "../lib/natsClient";
import { useCountdown } from "../lib/useCountdown";
import { withExpectedStartTimes } from "../lib/queueTiming";
import { formatDuration, formatTimeOfDay } from "../lib/format";
import { useAddToQueue } from "../lib/useAddToQueue";
import { useTimeFormat } from "../lib/useTimeFormat";
import { ProgressBar } from "../components/ProgressBar";
import { MediaKindBadge } from "../components/MediaKindBadge";

const NOW_PLAYING_KEY = ["now-playing"];
const QUEUE_KEY = ["queue"];
const JINGLES_KEY = ["library", "jingles"];
const SCRATCH_PAD_KEY = ["settings", "scratch-pad"];
const UPCOMING_COUNT = 5;
const MAX_SEARCH_RESULTS = 10;

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

  const jinglesQuery = useQuery({
    queryKey: JINGLES_KEY,
    queryFn: () => apiClient.get<JingleDTO[]>("/library/jingles"),
  });

  const scratchPadQuery = useQuery({
    queryKey: SCRATCH_PAD_KEY,
    queryFn: () => apiClient.get<ScratchPadDTO>("/settings/scratch-pad"),
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

  const modeMutation = useMutation({
    mutationFn: (mode: PlaybackMode) => apiClient.post("/queue/mode", { mode }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOW_PLAYING_KEY }),
    onError: (err) => setActionError(describeError(err, "change mode")),
  });

  const [liveMicSession, setLiveMicSession] = useState<LiveMicSessionDTO | null>(null);
  const startLiveMicMutation = useMutation({
    mutationFn: () => apiClient.post<LiveMicSessionDTO>("/live-mic/session"),
    onSuccess: (session) => setLiveMicSession(session),
    onError: (err) => setActionError(describeError(err, "go on air")),
  });
  const stopLiveMicMutation = useMutation({
    mutationFn: (sessionId: string) => apiClient.post(`/live-mic/session/${sessionId}/stop`),
    onSuccess: () => setLiveMicSession(null),
    onError: (err) => setActionError(describeError(err, "stop the live mic")),
  });

  const [jingleError, setJingleError] = useState<string | null>(null);
  const playJingleMutation = useMutation({
    mutationFn: (jingleId: string) => apiClient.post("/queue/jingle/play", { jingleId }),
    onError: (err) => setJingleError(describeError(err, "play jingle")),
  });
  const stopJingleMutation = useMutation({
    mutationFn: () => apiClient.post("/queue/jingle/stop"),
    onError: (err) => setJingleError(describeError(err, "stop jingle")),
  });

  const nowPlaying = nowPlayingQuery.data;

  const upNextAll = useMemo(
    () => withExpectedStartTimes(nowPlaying, queueQuery.data ?? []),
    [nowPlaying, queueQuery.data],
  );
  const upNext = upNextAll.slice(0, UPCOMING_COUNT);
  const upNextMoreCount = Math.max(0, upNextAll.length - UPCOMING_COUNT);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <NowPlayingSection
            nowPlaying={nowPlayingQuery.data}
            isLoading={nowPlayingQuery.isLoading}
            isError={nowPlayingQuery.isError}
            countdown={nowPlayingCountdown}
            onSkip={() => skipMutation.mutate()}
            skipDisabled={skipMutation.isPending}
          />
          <UpNextSection upNext={upNext} moreCount={upNextMoreCount} />
          <QuickAddSection />
        </div>

        <div className="flex flex-col gap-6">
          <StatusSection
            nowPlaying={nowPlaying}
            actionError={actionError}
            modeBusy={modeMutation.isPending}
            onSetMode={(mode) => modeMutation.mutate(mode)}
            isOnAir={liveMicSession !== null}
            liveMicBusy={startLiveMicMutation.isPending || stopLiveMicMutation.isPending}
            onToggleLiveMic={() =>
              liveMicSession ? stopLiveMicMutation.mutate(liveMicSession.sessionId) : startLiveMicMutation.mutate()
            }
          />
          <ScratchPadSection
            scratchPad={scratchPadQuery.data}
            jingles={jinglesQuery.data ?? []}
            currentJingle={currentJingle}
            jingleCountdown={jingleCountdown ? formatDuration(jingleCountdown.remainingMs) : null}
            jingleProgress={jingleCountdown?.progress ?? null}
            jingleError={jingleError}
            onPlay={(jingleId) => playJingleMutation.mutate(jingleId)}
            onStop={() => stopJingleMutation.mutate()}
            playPending={playJingleMutation.isPending}
            stopPending={stopJingleMutation.isPending}
          />
        </div>
      </div>
    </div>
  );
}

function NowPlayingSection({
  nowPlaying,
  isLoading,
  isError,
  countdown,
  onSkip,
  skipDisabled,
}: {
  nowPlaying: NowPlayingDTO | undefined;
  isLoading: boolean;
  isError: boolean;
  countdown: ReturnType<typeof useCountdown>;
  onSkip: () => void;
  skipDisabled: boolean;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Now Playing</h2>
        <button
          type="button"
          disabled={skipDisabled}
          onClick={onSkip}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Next
        </button>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Could not load now-playing status.</p>}

      {nowPlaying && (
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
            {nowPlaying.coverArtUrl ? (
              <img src={apiUrl(nowPlaying.coverArtUrl)} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-2xl">&#9835;</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-medium text-slate-900">{nowPlaying.title ?? "Off air"}</div>
            <div className="truncate text-sm text-slate-500">
              {nowPlaying.artist ?? "—"}
              {nowPlaying.album ? ` · ${nowPlaying.album}` : ""}
            </div>
            {countdown && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1">
                  <ProgressBar progress={countdown.progress} />
                </div>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">-{formatDuration(countdown.remainingMs)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function UpNextSection({
  upNext,
  moreCount,
}: {
  upNext: ReturnType<typeof withExpectedStartTimes>;
  moreCount: number;
}) {
  const timeFormat = useTimeFormat();

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Up Next</h2>
      {upNext.length === 0 ? (
        <p className="text-sm text-slate-500">The queue is empty.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {upNext.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 text-sm">
                <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-400">
                  {formatTimeOfDay(entry.expectedStartAt, timeFormat)}
                </span>
                <span className="truncate text-slate-800">{entry.title}</span>
                {entry.artist && <span className="shrink-0 truncate text-slate-400">— {entry.artist}</span>}
                <span className="ml-auto shrink-0">
                  <MediaKindBadge kind={entry.mediaKind} />
                </span>
              </li>
            ))}
          </ul>
          {moreCount > 0 && (
            <Link to="/queue" className="mt-2 inline-block text-xs text-slate-400 hover:text-slate-600 hover:underline">
              … {moreCount} more
            </Link>
          )}
        </>
      )}
    </section>
  );
}

interface QuickAddResult {
  mediaKind: MediaKind;
  id: string;
  title: string;
  subtitle: string | null;
  durationMs: number;
}

function QuickAddSection() {
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

  const results = useMemo<QuickAddResult[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];

    const songResults: QuickAddResult[] = (songsQuery.data ?? [])
      .filter((song) => song.isActive && `${song.title} ${song.artist}`.toLowerCase().includes(q))
      .map((song) => ({ mediaKind: "SONG", id: song.id, title: song.title, subtitle: song.artist, durationMs: song.durationMs }));

    const jingleResults: QuickAddResult[] = (jinglesQuery.data ?? [])
      .filter((jingle) => jingle.isActive && jingle.title.toLowerCase().includes(q))
      .map((jingle) => ({ mediaKind: "JINGLE", id: jingle.id, title: jingle.title, subtitle: null, durationMs: jingle.durationMs }));

    return [...songResults, ...jingleResults].slice(0, MAX_SEARCH_RESULTS);
  }, [songsQuery.data, jinglesQuery.data, search]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Quick Add</h2>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search songs and jingles by title…"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />

      {search.trim() !== "" && (
        <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-100">
          {results.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">No matching songs or jingles.</p>}
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

type StatusLabel = "OFF" | "AUTO" | "MANUAL";

const STATUS_STYLES: Record<StatusLabel, string> = {
  OFF: "border border-slate-300 bg-white text-black",
  AUTO: "bg-green-700 text-white",
  MANUAL: "bg-yellow-400 text-black",
};

function StatusSection({
  nowPlaying,
  actionError,
  modeBusy,
  onSetMode,
  isOnAir,
  liveMicBusy,
  onToggleLiveMic,
}: {
  nowPlaying: NowPlayingDTO | undefined;
  actionError: string | null;
  modeBusy: boolean;
  onSetMode: (mode: PlaybackMode) => void;
  isOnAir: boolean;
  liveMicBusy: boolean;
  onToggleLiveMic: () => void;
}) {
  // MANUAL is a deliberate operator choice, not a playback state -- it stays
  // "MANUAL" even while paused on silence between tracks (that's the whole
  // point of manual mode: the queue won't auto-advance until Skip is
  // clicked). "OFF" is reserved for AUTO mode with nothing to play.
  const statusLabel: StatusLabel = !nowPlaying
    ? "OFF"
    : nowPlaying.mode === "MANUAL"
      ? "MANUAL"
      : nowPlaying.type === "silence"
        ? "OFF"
        : "AUTO";
  const isOff = statusLabel === "OFF";

  function handleToggleMode() {
    if (isOff || !nowPlaying) return;
    onSetMode(nowPlaying.mode === "LIVE" ? "MANUAL" : "LIVE");
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Status</h2>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={isOff || modeBusy}
          onClick={handleToggleMode}
          className={`flex flex-1 items-center justify-center rounded-lg px-6 py-6 text-2xl font-bold tracking-wide transition-opacity disabled:cursor-not-allowed ${
            isOff ? "" : "hover:opacity-90 disabled:opacity-60"
          } ${STATUS_STYLES[statusLabel]}`}
        >
          {statusLabel}
        </button>
        <button
          type="button"
          disabled={liveMicBusy}
          onClick={onToggleLiveMic}
          className={`flex flex-1 items-center justify-center rounded-lg px-6 py-6 text-2xl font-bold tracking-wide transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${
            isOnAir ? "bg-red-700 text-white" : "bg-slate-200 text-slate-500"
          }`}
        >
          {isOnAir ? "ON AIR" : "off air"}
        </button>
      </div>

      {actionError && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>
      )}
    </section>
  );
}

function ScratchPadSection({
  scratchPad,
  jingles,
  currentJingle,
  jingleCountdown,
  jingleProgress,
  jingleError,
  onPlay,
  onStop,
  playPending,
  stopPending,
}: {
  scratchPad: ScratchPadDTO | undefined;
  jingles: JingleDTO[];
  currentJingle: CurrentJingle | null;
  jingleCountdown: string | null;
  jingleProgress: number | null;
  jingleError: string | null;
  onPlay: (jingleId: string) => void;
  onStop: () => void;
  playPending: boolean;
  stopPending: boolean;
}) {
  const jingleById = useMemo(() => new Map(jingles.map((jingle) => [jingle.id, jingle])), [jingles]);
  const slots = useMemo(
    () => [...(scratchPad?.slots ?? [])].sort((a, b) => a.position - b.position),
    [scratchPad],
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Scratch Pad</h2>

      {jingleError && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{jingleError}</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(slots.length > 0 ? slots : Array.from({ length: 10 }, (_, position) => ({ position, jingleId: null }))).map((slot) => {
          const jingle = slot.jingleId ? jingleById.get(slot.jingleId) : undefined;
          const isMissing = !!slot.jingleId && !jingle;
          const isPlaying = !!slot.jingleId && currentJingle?.jingleId === slot.jingleId;
          const busy = isPlaying ? stopPending : playPending;

          return (
            <button
              key={slot.position}
              type="button"
              disabled={!jingle || busy}
              onClick={() => {
                if (!jingle) return;
                if (isPlaying) onStop();
                else onPlay(jingle.id);
              }}
              title={jingle?.title}
              className={`relative isolate flex h-20 flex-col items-center justify-center overflow-hidden rounded-lg border px-2 py-2 text-center text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                isPlaying
                  ? "border-blue-900 bg-blue-900 text-white"
                  : jingle
                    ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    : "border-dashed border-slate-200 bg-slate-50 text-slate-400"
              }`}
            >
              {isPlaying && (
                <div
                  className="absolute inset-y-0 left-0 bg-blue-500 transition-[width] duration-500 ease-linear"
                  style={{ width: `${Math.min(100, (jingleProgress ?? 0) * 100)}%` }}
                />
              )}
              {isPlaying && jingleCountdown && (
                <span className="absolute right-1 top-1 z-10 text-[10px] font-semibold tabular-nums text-white">
                  -{jingleCountdown}
                </span>
              )}
              <span className="relative z-10 line-clamp-2 wrap-break-word">
                {jingle ? jingle.title : isMissing ? "Missing" : "Empty"}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Assign jingles to these buttons under Settings → Scratch Pad.
      </p>
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
