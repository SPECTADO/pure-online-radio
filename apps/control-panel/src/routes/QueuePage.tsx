import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, DragOverlay, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  NowPlayingDTO,
  NowPlayingStatus,
  QueueEntryDTO,
  TimeFormat,
  UpcomingTriggerDTO,
} from "@spectado/shared-types";
import { NATS_SUBJECTS } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { useNatsSubject } from "../lib/natsClient";
import { useCountdownTo } from "../lib/useCountdownTo";
import { useTimeFormat } from "../lib/useTimeFormat";
import { buildUpNextList, type UpNextDisplayEntry } from "../lib/queueTiming";
import { useQueueReorder } from "../lib/useQueueReorder";
import { ComingSoon } from "../components/ComingSoon";
import { Modal } from "../components/Modal";
import { MediaKindBadge } from "../components/MediaKindBadge";
import { ScheduledTag } from "../components/ScheduledTag";
import { QuickAddSection } from "../components/QuickAddSection";
import { formatDuration, formatTimeOfDay } from "../lib/format";
import { rowActionButtonDanger } from "../lib/buttonStyles";

type QueuedRow = Extract<UpNextDisplayEntry, { kind: "queued" }>;

const QUEUE_KEY = ["queue"];
const UPCOMING_TRIGGERS_KEY = ["queue", "upcoming-triggers"];
const NOW_PLAYING_KEY = ["now-playing"];

export function QueuePage() {
  const queryClient = useQueryClient();
  const timeFormat = useTimeFormat();
  const [pendingRemove, setPendingRemove] = useState<QueueEntryDTO | null>(null);
  const [showClearRotation, setShowClearRotation] = useState(false);

  const queueQuery = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: () => apiClient.get<QueueEntryDTO[]>("/queue"),
    retry: false,
    refetchInterval: 10_000,
  });

  // Live push the moment a manager (this one or another) adds/removes a
  // queue item, on top of the 10s poll fallback -- same pattern as Dashboard.
  useNatsSubject(NATS_SUBJECTS.control.queueUpdated, () => {
    queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
  });

  // Not-yet-fired schedule/external-stream previews -- change far less often than the queue.
  const upcomingTriggersQuery = useQuery({
    queryKey: UPCOMING_TRIGGERS_KEY,
    queryFn: () => apiClient.get<UpcomingTriggerDTO[]>("/queue/upcoming-triggers"),
    retry: false,
    refetchInterval: 30_000,
  });

  // Needed (not displayed directly) to compute each item's expected start
  // time -- when the currently-playing item is expected to end is the base
  // that queue durations get added onto.
  const nowPlayingQuery = useQuery({
    queryKey: NOW_PLAYING_KEY,
    queryFn: () => apiClient.get<NowPlayingDTO>("/public/now-playing"),
    refetchInterval: 10_000,
  });
  useNatsSubject<NowPlayingStatus>(NATS_SUBJECTS.encoderStatus.nowPlaying, (data) => {
    queryClient.setQueryData<NowPlayingDTO>(NOW_PLAYING_KEY, data);
  });

  const mergedList = useMemo(
    () => buildUpNextList(nowPlayingQuery.data, queueQuery.data ?? [], upcomingTriggersQuery.data ?? []),
    [nowPlayingQuery.data, queueQuery.data, upcomingTriggersQuery.data],
  );

  const {
    manualEntries,
    rotationEntries,
    sensors,
    activeId,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  } = useQueueReorder(queueQuery.data ?? []);

  // Combined, in-render-order set of every draggable id -- dnd-kit's SortableContext
  // needs this to match visual order for correct drag animations/keyboard nav.
  const draggableRows = useMemo(
    () =>
      mergedList.filter(
        (row): row is QueuedRow => row.kind === "queued" && (row.entry.scheduledFor === null || row.entry.clockWheelName !== null),
      ),
    [mergedList],
  );

  const queuedRows = mergedList.filter((row): row is QueuedRow => row.kind === "queued");
  const lastQueuedRow = queuedRows[queuedRows.length - 1];
  const plannedTillMs = lastQueuedRow ? lastQueuedRow.expectedAt + lastQueuedRow.entry.durationMs : null;
  const firstItemCountdownMs = useCountdownTo(mergedList[0]?.expectedAt ?? null);

  const removeMutation = useMutation({
    mutationFn: (item: QueueEntryDTO) => apiClient.delete(`/queue/items/${item.id}`),
    onSuccess: (_data, item) => {
      queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
      showToast("success", `Removed "${item.title}" from the queue`);
      setPendingRemove(null);
    },
    onError: (err, item) => {
      showToast(
        "error",
        `Couldn't remove "${item.title}": ${err instanceof ApiError ? err.message : "request failed"}`,
      );
    },
  });

  // Bulk-removes every clock-wheel-filled item -- the engine regenerates fresh rotation
  // content on its next tick, so this reads as "start the rotation over", not a lasting gap.
  const clearRotationMutation = useMutation({
    mutationFn: () => apiClient.delete<{ removed: number }>("/queue/rotation"),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
      showToast("success", `Removed ${result.removed} rotation item${result.removed === 1 ? "" : "s"} from the queue`);
      setShowClearRotation(false);
    },
    onError: (err) => {
      showToast(
        "error",
        `Couldn't clear rotation items: ${err instanceof ApiError ? err.message : "request failed"}`,
      );
    },
  });

  const activeRow = draggableRows.find((row) => row.entry.id === activeId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Queue</h1>
        <div className="flex items-center gap-4">
          {plannedTillMs !== null && (
            <span className="text-sm text-slate-500">
              Planned till{" "}
              <span className="tabular-nums font-medium text-slate-700">
                {formatTimeOfDay(plannedTillMs, timeFormat)}
              </span>
            </span>
          )}
          {rotationEntries.length > 0 && (
            <button type="button" onClick={() => setShowClearRotation(true)} className={rowActionButtonDanger}>
              Clear rotation
            </button>
          )}
        </div>
      </div>

      <QuickAddSection />

      {queueQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {queueQuery.isError && queueQuery.error instanceof ApiError && queueQuery.error.isNotImplemented && (
        <ComingSoon
          title="Manual queue"
          detail="Queueing one-off tracks and jingles isn't implemented yet."
        />
      )}

      {queueQuery.isError && !(queueQuery.error instanceof ApiError && queueQuery.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load the queue: {(queueQuery.error as Error).message}
        </div>
      )}

      {queueQuery.data && mergedList.length === 0 && (
        <ComingSoon title="Queue is empty" detail="Items added to the manual queue appear here." />
      )}

      {queueQuery.data && mergedList.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Starts at</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <SortableContext
                  items={draggableRows.map((row) => row.entry.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {mergedList.map((row, index) => {
                    const countdownMs = index === 0 ? firstItemCountdownMs : null;
                    if (row.kind === "queued" && row.entry.scheduledFor === null) {
                      return (
                        <ManualQueueRow
                          key={row.key}
                          entry={row.entry}
                          expectedAt={row.expectedAt}
                          timeFormat={timeFormat}
                          countdownMs={countdownMs}
                          onRemove={() => setPendingRemove(row.entry)}
                        />
                      );
                    }
                    if (row.kind === "queued" && row.entry.clockWheelName !== null) {
                      return (
                        <ManualQueueRow
                          key={row.key}
                          entry={row.entry}
                          expectedAt={row.expectedAt}
                          timeFormat={timeFormat}
                          countdownMs={countdownMs}
                          tagLabel="Rotation"
                          onRemove={() => setPendingRemove(row.entry)}
                        />
                      );
                    }
                    if (row.kind === "queued") {
                      return (
                        <StaticQueueRow
                          key={row.key}
                          expectedAt={row.expectedAt}
                          timeFormat={timeFormat}
                          countdownMs={countdownMs}
                          title={row.entry.title}
                          artist={row.entry.artist}
                          mediaKind={row.entry.mediaKind}
                          durationMs={row.entry.durationMs}
                          tagLabel="Scheduled"
                          onRemove={() => setPendingRemove(row.entry)}
                        />
                      );
                    }
                    return (
                      <TriggerPreviewRow
                        key={row.key}
                        expectedAt={row.expectedAt}
                        timeFormat={timeFormat}
                        countdownMs={countdownMs}
                        trigger={row.trigger}
                      />
                    );
                  })}
                </SortableContext>
              </tbody>
            </table>
          </div>

          <DragOverlay>
            {activeRow && (
              <table className="w-full text-left text-sm shadow-xl">
                <tbody>
                  <tr className="rounded-lg border border-slate-300 bg-white">
                    <td className="rounded-l-lg px-4 py-3 text-slate-600">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">⠿</span>
                        <span>{formatTimeOfDay(activeRow.expectedAt, timeFormat)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {activeRow.entry.title}
                      {activeRow.entry.artist && (
                        <span className="ml-2 font-normal text-slate-500">{activeRow.entry.artist}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <MediaKindBadge kind={activeRow.entry.mediaKind} />
                    </td>
                    <td className="rounded-r-lg px-4 py-3 text-slate-600">
                      {formatDuration(activeRow.entry.durationMs)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {pendingRemove && (
        <Modal title="Remove from queue" onClose={() => setPendingRemove(null)}>
          <p className="text-sm text-slate-600">Remove "{pendingRemove.title}" from the queue?</p>
          {removeMutation.isError && (
            <p className="mt-2 text-sm text-red-600">
              {removeMutation.error instanceof Error ? removeMutation.error.message : "Remove failed"}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingRemove(null)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => removeMutation.mutate(pendingRemove)}
              disabled={removeMutation.isPending}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {removeMutation.isPending ? "Removing…" : "Remove"}
            </button>
          </div>
        </Modal>
      )}

      {showClearRotation && (
        <Modal title="Clear rotation" onClose={() => setShowClearRotation(false)}>
          <p className="text-sm text-slate-600">
            Remove all {rotationEntries.length} clock-wheel-filled item{rotationEntries.length === 1 ? "" : "s"} from
            the queue? The rotation will refill on its own shortly after.
          </p>
          {clearRotationMutation.isError && (
            <p className="mt-2 text-sm text-red-600">
              {clearRotationMutation.error instanceof Error ? clearRotationMutation.error.message : "Clear failed"}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowClearRotation(false)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => clearRotationMutation.mutate()}
              disabled={clearRotationMutation.isPending}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {clearRotationMutation.isPending ? "Clearing…" : "Clear rotation"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StartsAtCell({
  expectedAt,
  timeFormat,
  countdownMs,
}: {
  expectedAt: number;
  timeFormat: TimeFormat;
  countdownMs: number | null;
}) {
  return (
    <span>
      {formatTimeOfDay(expectedAt, timeFormat)}
      {countdownMs !== null && (
        <span className="ml-2 text-xs tabular-nums text-slate-400">(in {formatDuration(countdownMs)})</span>
      )}
    </span>
  );
}

function ManualQueueRow({
  entry,
  expectedAt,
  timeFormat,
  countdownMs,
  tagLabel,
  onRemove,
}: {
  entry: QueueEntryDTO;
  expectedAt: number;
  timeFormat: TimeFormat;
  countdownMs: number | null;
  tagLabel?: string;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id });

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`cursor-grab touch-none select-none active:cursor-grabbing ${
        isDragging ? "relative z-10 bg-slate-50 opacity-50" : ""
      }`}
    >
      <td className="px-4 py-3 text-slate-600">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-slate-300">
            ⠿
          </span>
          <StartsAtCell expectedAt={expectedAt} timeFormat={timeFormat} countdownMs={countdownMs} />
        </div>
      </td>
      <td className="px-4 py-3 font-medium text-slate-900">
        <div className="flex items-center gap-2">
          <span>
            {entry.title}
            {entry.artist && <span className="ml-2 font-normal text-slate-500">{entry.artist}</span>}
          </span>
          {tagLabel && <ScheduledTag label={tagLabel} />}
        </div>
      </td>
      <td className="px-4 py-3">
        <MediaKindBadge kind={entry.mediaKind} />
      </td>
      <td className="px-4 py-3 text-slate-600">{formatDuration(entry.durationMs)}</td>
      <td className="px-4 py-3">
        {/* Stops the drag listeners above from swallowing a plain button click. */}
        <div className="flex justify-end" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={onRemove} className={rowActionButtonDanger}>
            Remove
          </button>
        </div>
      </td>
    </tr>
  );
}

/** A real, already-materialized ScheduledItem that isn't draggable (due/schedule-fired) --
 * same shape as ManualQueueRow, minus the drag handle, plus a "Scheduled" tag. */
function StaticQueueRow({
  expectedAt,
  timeFormat,
  countdownMs,
  title,
  artist,
  mediaKind,
  durationMs,
  tagLabel,
  onRemove,
}: {
  expectedAt: number;
  timeFormat: TimeFormat;
  countdownMs: number | null;
  title: string;
  artist: string | null;
  mediaKind: QueueEntryDTO["mediaKind"];
  durationMs: number;
  tagLabel: string;
  onRemove: () => void;
}) {
  return (
    <tr className="bg-slate-50/50">
      <td className="px-4 py-3 text-slate-600">
        <StartsAtCell expectedAt={expectedAt} timeFormat={timeFormat} countdownMs={countdownMs} />
      </td>
      <td className="px-4 py-3 font-medium text-slate-900">
        <div className="flex items-center gap-2">
          <span>
            {title}
            {artist && <span className="ml-2 font-normal text-slate-500">{artist}</span>}
          </span>
          <ScheduledTag label={tagLabel} />
        </div>
      </td>
      <td className="px-4 py-3">
        <MediaKindBadge kind={mediaKind} />
      </td>
      <td className="px-4 py-3 text-slate-600">{formatDuration(durationMs)}</td>
      <td className="px-4 py-3">
        <div className="flex justify-end">
          <button type="button" onClick={onRemove} className={rowActionButtonDanger}>
            Remove
          </button>
        </div>
      </td>
    </tr>
  );
}

/** A not-yet-fired ScheduleRule/ExternalStream preview -- read-only, nothing to remove yet. */
function TriggerPreviewRow({
  expectedAt,
  timeFormat,
  countdownMs,
  trigger,
}: {
  expectedAt: number;
  timeFormat: TimeFormat;
  countdownMs: number | null;
  trigger: UpcomingTriggerDTO;
}) {
  return (
    <tr className="bg-slate-50/50">
      <td className="px-4 py-3 text-slate-600">
        <StartsAtCell expectedAt={expectedAt} timeFormat={timeFormat} countdownMs={countdownMs} />
      </td>
      <td className="px-4 py-3 font-medium text-slate-500 italic">
        <div className="flex items-center gap-2">
          <span>{trigger.name}</span>
          <ScheduledTag label={trigger.kind === "SCHEDULE_RULE" ? "Scheduled" : "External stream"} />
        </div>
      </td>
      <td className="px-4 py-3 text-slate-400">
        {trigger.kind === "SCHEDULE_RULE"
          ? `${trigger.itemCount ?? 0} item${trigger.itemCount === 1 ? "" : "s"}`
          : "Relay"}
      </td>
      <td className="px-4 py-3 text-slate-400">—</td>
      <td className="px-4 py-3" />
    </tr>
  );
}
