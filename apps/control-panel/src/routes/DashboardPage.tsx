import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, DragOverlay, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  JingleDTO,
  JingleEndedStatus,
  JingleStartedStatus,
  LiveMicSessionDTO,
  NowPlayingDTO,
  NowPlayingStatus,
  PlaybackMode,
  QueueEntryDTO,
  ScratchPadDTO,
  UpcomingTriggerDTO,
} from "@spectado/shared-types";
import { NATS_SUBJECTS } from "@spectado/shared-types";
import { apiClient, apiUrl, ApiError } from "../lib/apiClient";
import { useNatsSubject } from "../lib/natsClient";
import { useCountdown } from "../lib/useCountdown";
import { useNow } from "../lib/useNow";
import { buildUpNextList, type UpNextDisplayEntry } from "../lib/queueTiming";
import { useQueueReorder } from "../lib/useQueueReorder";
import { formatDuration, formatTimeOfDay } from "../lib/format";
import { useTimeFormat } from "../lib/useTimeFormat";
import { ProgressBar } from "../components/ProgressBar";
import { MediaKindBadge } from "../components/MediaKindBadge";
import { QuickAddSection } from "../components/QuickAddSection";
import { ScheduledTag } from "../components/ScheduledTag";

const NOW_PLAYING_KEY = ["now-playing"];
const QUEUE_KEY = ["queue"];
const UPCOMING_TRIGGERS_KEY = ["queue", "upcoming-triggers"];
const JINGLES_KEY = ["library", "jingles"];
const SCRATCH_PAD_KEY = ["settings", "scratch-pad"];
const UP_NEXT_WINDOW_MS = 60 * 60 * 1000;

interface CurrentJingle {
  jingleId: string;
  title: string;
  durationMs: number;
  startedAt: string;
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const now = useNow();
  const timeFormat = useTimeFormat();

  const nowPlayingQuery = useQuery({
    queryKey: NOW_PLAYING_KEY,
    queryFn: () => apiClient.get<NowPlayingDTO>("/public/now-playing"),
    refetchInterval: 10_000,
  });

  // Live push updates from the encoder (via the api's re-broadcast) take
  // precedence over the poll the moment one arrives.
  useNatsSubject<NowPlayingStatus>(NATS_SUBJECTS.encoderStatus.nowPlaying, (data) => {
    const previousStartedAt = queryClient.getQueryData<NowPlayingDTO>(NOW_PLAYING_KEY)?.startedAt;
    queryClient.setQueryData<NowPlayingDTO>(NOW_PLAYING_KEY, data);

    // A genuine track change (not, say, a same-track AUTO/MANUAL mode
    // republish, which reuses the same startedAt) -- the api only drops the
    // now-playing item off /queue a moment after this event fires, so wait
    // it out before refreshing "Up Next" or we'd just get the stale list back.
    if (previousStartedAt !== data.startedAt) {
      setTimeout(() => queryClient.invalidateQueries({ queryKey: QUEUE_KEY }), 1000);
    }
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

  // Not-yet-fired schedule/external-stream previews -- these change far less often than the
  // queue itself, so a slower poll is enough.
  const upcomingTriggersQuery = useQuery({
    queryKey: UPCOMING_TRIGGERS_KEY,
    queryFn: () => apiClient.get<UpcomingTriggerDTO[]>("/queue/upcoming-triggers"),
    retry: false,
    refetchInterval: 30_000,
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
    () => buildUpNextList(nowPlaying, queueQuery.data ?? [], upcomingTriggersQuery.data ?? []),
    [nowPlaying, queueQuery.data, upcomingTriggersQuery.data],
  );
  const upNext = useMemo(
    () => upNextAll.filter((row) => row.expectedAt <= now + UP_NEXT_WINDOW_MS),
    [upNextAll, now],
  );
  const upNextMoreCount = upNextAll.length - upNext.length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex justify-end">
        <span className="tabular-nums text-3xl font-semibold text-slate-700">
          {formatTimeOfDay(now, timeFormat)}
        </span>
      </div>
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
          <UpNextSection upNext={upNext} moreCount={upNextMoreCount} queueEntries={queueQuery.data ?? []} />
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
          <QuickAddSection />
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

/** True for rows the Queue page's reorder endpoint accepts -- manual (unscheduled) items and
 * clock-wheel rotation fills. Due schedule-fired items and not-yet-fired trigger previews are
 * positioned wherever their expected time falls and aren't draggable. */
function isDraggableUpNextRow(row: UpNextDisplayEntry): row is Extract<UpNextDisplayEntry, { kind: "queued" }> {
  return row.kind === "queued" && (row.entry.scheduledFor === null || row.entry.clockWheelName !== null);
}

function upNextRowContent(row: UpNextDisplayEntry, timeFormat: ReturnType<typeof useTimeFormat>) {
  return (
    <>
      <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-400">
        {formatTimeOfDay(row.expectedAt, timeFormat)}
      </span>
      {row.kind === "queued" ? (
        <>
          <span className="shrink-0 truncate text-slate-800">{row.entry.title}</span>
          {row.entry.artist && <span className="truncate text-slate-400">— {row.entry.artist}</span>}
          {row.entry.scheduleRuleName && <ScheduledTag label="Scheduled" />}
          {row.entry.clockWheelName && <ScheduledTag label="Rotation" />}
          <span className="ml-auto shrink-0">
            <MediaKindBadge kind={row.entry.mediaKind} />
          </span>
        </>
      ) : (
        <>
          <span className="truncate text-slate-500 italic">{row.trigger.name}</span>
          <span className="ml-auto shrink-0">
            <ScheduledTag label={row.kind === "SCHEDULE_RULE" ? "Scheduled" : "External stream"} />
          </span>
        </>
      )}
    </>
  );
}

function DraggableUpNextRow({
  row,
  timeFormat,
}: {
  row: Extract<UpNextDisplayEntry, { kind: "queued" }>;
  timeFormat: ReturnType<typeof useTimeFormat>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.entry.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`flex cursor-grab touch-none select-none items-center gap-2 text-sm active:cursor-grabbing ${
        isDragging ? "relative z-10 rounded bg-slate-50 opacity-50" : ""
      }`}
    >
      <span aria-hidden="true" className="shrink-0 text-slate-300">
        ⠿
      </span>
      {upNextRowContent(row, timeFormat)}
    </li>
  );
}

function StaticUpNextRow({ row, timeFormat }: { row: UpNextDisplayEntry; timeFormat: ReturnType<typeof useTimeFormat> }) {
  return (
    <li className="flex items-center gap-2 pl-5.5 text-sm">
      {upNextRowContent(row, timeFormat)}
    </li>
  );
}

function UpNextSection({
  upNext,
  moreCount,
  queueEntries,
}: {
  upNext: UpNextDisplayEntry[];
  moreCount: number;
  queueEntries: QueueEntryDTO[];
}) {
  const timeFormat = useTimeFormat();
  const { sensors, activeId, handleDragStart, handleDragEnd, handleDragCancel } = useQueueReorder(queueEntries);

  const draggableIds = useMemo(() => upNext.filter(isDraggableUpNextRow).map((row) => row.entry.id), [upNext]);
  const activeRow = useMemo(
    () => upNext.find((row) => isDraggableUpNextRow(row) && row.entry.id === activeId) as
      | Extract<UpNextDisplayEntry, { kind: "queued" }>
      | undefined,
    [upNext, activeId],
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Up Next</h2>
      {upNext.length === 0 ? (
        <p className="text-sm text-slate-500">The queue is empty.</p>
      ) : (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={draggableIds} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-2">
                {upNext.map((row) =>
                  isDraggableUpNextRow(row) ? (
                    <DraggableUpNextRow key={row.key} row={row} timeFormat={timeFormat} />
                  ) : (
                    <StaticUpNextRow key={row.key} row={row} timeFormat={timeFormat} />
                  ),
                )}
              </ul>
            </SortableContext>
            <DragOverlay>
              {activeRow && (
                <ul className="rounded-md border border-slate-300 bg-white px-2 py-1 shadow-xl">
                  <li className="flex items-center gap-2 text-sm">
                    <span aria-hidden="true" className="shrink-0 text-slate-300">
                      ⠿
                    </span>
                    {upNextRowContent(activeRow, timeFormat)}
                  </li>
                </ul>
              )}
            </DragOverlay>
          </DndContext>
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

type StatusLabel = "OFF" | "AUTO" | "MANUAL";

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 shrink-0" aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
      <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.08A7 7 0 0 0 19 11z" />
    </svg>
  );
}

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
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-6 py-6 text-2xl font-bold tracking-wide transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${
            isOnAir ? "bg-red-700 text-white" : "bg-slate-200 text-slate-500"
          }`}
        >
          <MicIcon />
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
