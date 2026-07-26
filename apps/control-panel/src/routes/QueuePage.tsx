import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { NowPlayingDTO, NowPlayingStatus, QueueEntryDTO, SongDTO, TimeFormat } from "@spectado/shared-types";
import { NATS_SUBJECTS } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { useNatsSubject } from "../lib/natsClient";
import { useAddToQueue } from "../lib/useAddToQueue";
import { useCountdownTo } from "../lib/useCountdownTo";
import { useTimeFormat } from "../lib/useTimeFormat";
import { withExpectedStartTimes } from "../lib/queueTiming";
import { ComingSoon } from "../components/ComingSoon";
import { Modal } from "../components/Modal";
import { MediaKindBadge } from "../components/MediaKindBadge";
import { formatDuration, formatTimeOfDay } from "../lib/format";
import { rowActionButton, rowActionButtonDanger } from "../lib/buttonStyles";

type QueueItemWithStart = QueueEntryDTO & { expectedStartAt: number };

const selectClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

const QUEUE_KEY = ["queue"];
const NOW_PLAYING_KEY = ["now-playing"];
const MAX_SEARCH_RESULTS = 20;

export function QueuePage() {
  const queryClient = useQueryClient();
  const addToQueue = useAddToQueue();
  const timeFormat = useTimeFormat();
  const [search, setSearch] = useState("");
  const [pendingRemove, setPendingRemove] = useState<QueueEntryDTO | null>(null);

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

  const itemsWithStart = useMemo(
    () => withExpectedStartTimes(nowPlayingQuery.data, queueQuery.data ?? []),
    [nowPlayingQuery.data, queueQuery.data],
  );
  const firstItemCountdownMs = useCountdownTo(itemsWithStart[0]?.expectedStartAt ?? null);
  const lastItem = itemsWithStart[itemsWithStart.length - 1];
  const plannedTillMs = lastItem ? lastItem.expectedStartAt + lastItem.durationMs : null;

  const songsQuery = useQuery({
    queryKey: ["library", "songs"],
    queryFn: () => apiClient.get<SongDTO[]>("/library/songs"),
  });

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return (songsQuery.data ?? [])
      .filter((song) => `${song.title} ${song.artist}`.toLowerCase().includes(q))
      .slice(0, MAX_SEARCH_RESULTS);
  }, [songsQuery.data, search]);

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

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) => apiClient.patch("/queue/items/reorder", { orderedIds }),
    // Reorder the cached list immediately so a drag-drop (or an up/down click)
    // lands exactly where it was dropped instead of snapping back to the old
    // order until the request round-trips.
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: QUEUE_KEY });
      const previous = queryClient.getQueryData<QueueEntryDTO[]>(QUEUE_KEY);
      if (previous) {
        const byId = new Map(previous.map((item) => [item.id, item]));
        queryClient.setQueryData<QueueEntryDTO[]>(
          QUEUE_KEY,
          orderedIds.map((id) => byId.get(id)).filter((item): item is QueueEntryDTO => item !== undefined),
        );
      }
      return { previous };
    },
    onError: (err, _orderedIds, context) => {
      if (context?.previous) queryClient.setQueryData(QUEUE_KEY, context.previous);
      showToast(
        "error",
        `Couldn't reorder the queue: ${err instanceof ApiError ? err.message : "request failed"}`,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUEUE_KEY }),
  });

  function reorderTo(items: QueueEntryDTO[], fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= items.length) return;
    reorderMutation.mutate(arrayMove(items, fromIndex, toIndex).map((item) => item.id));
  }

  function moveItem(items: QueueEntryDTO[], index: number, direction: -1 | 1) {
    reorderTo(items, index, index + direction);
  }

  const sensors = useSensors(
    // Requires a small drag before activating, so a plain click on the row
    // (or on the up/down/remove buttons) doesn't get swallowed as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeItem = itemsWithStart.find((item) => item.id === activeId) ?? null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = itemsWithStart.findIndex((item) => item.id === active.id);
    const newIndex = itemsWithStart.findIndex((item) => item.id === over.id);
    reorderTo(itemsWithStart, oldIndex, newIndex);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Queue</h1>
        {plannedTillMs !== null && (
          <span className="text-sm text-slate-500">
            Planned till{" "}
            <span className="tabular-nums font-medium text-slate-700">
              {formatTimeOfDay(plannedTillMs, timeFormat)}
            </span>
          </span>
        )}
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Add a song
        </h2>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title or artist…"
          className={`${selectClass} w-full`}
        />

        {search.trim() !== "" && (
          <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-100">
            {searchResults.length === 0 && (
              <p className="px-4 py-3 text-sm text-slate-500">No matching songs.</p>
            )}
            {searchResults.map((song) => (
              <div key={song.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{song.title}</div>
                  <div className="truncate text-xs text-slate-500">
                    {song.artist} · {formatDuration(song.durationMs)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => addToQueue.mutate({ mediaKind: "SONG", mediaId: song.id, title: song.title })}
                  className={`shrink-0 ${rowActionButton}`}
                >
                  Add to queue
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

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

      {queueQuery.data && queueQuery.data.length === 0 && (
        <ComingSoon title="Queue is empty" detail="Items added to the manual queue appear here." />
      )}

      {queueQuery.data && queueQuery.data.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
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
                  items={itemsWithStart.map((item) => item.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {itemsWithStart.map((entry, index, items) => (
                    <QueueRow
                      key={entry.id}
                      entry={entry}
                      timeFormat={timeFormat}
                      countdownMs={index === 0 ? firstItemCountdownMs : null}
                      isFirst={index === 0}
                      isLast={index === items.length - 1}
                      moveDisabled={reorderMutation.isPending}
                      onMoveUp={() => moveItem(items, index, -1)}
                      onMoveDown={() => moveItem(items, index, 1)}
                      onRemove={() => setPendingRemove(entry)}
                    />
                  ))}
                </SortableContext>
              </tbody>
            </table>
          </div>

          <DragOverlay>
            {activeItem && (
              <table className="w-full text-left text-sm shadow-xl">
                <tbody>
                  <tr className="rounded-lg border border-slate-300 bg-white">
                    <td className="rounded-l-lg px-4 py-3 text-slate-600">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">⠿</span>
                        <span>{formatTimeOfDay(activeItem.expectedStartAt, timeFormat)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {activeItem.title}
                      {activeItem.artist && (
                        <span className="ml-2 font-normal text-slate-500">{activeItem.artist}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <MediaKindBadge kind={activeItem.mediaKind} />
                    </td>
                    <td className="rounded-r-lg px-4 py-3 text-slate-600">
                      {formatDuration(activeItem.durationMs)}
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
    </div>
  );
}

function QueueRow({
  entry,
  timeFormat,
  countdownMs,
  isFirst,
  isLast,
  moveDisabled,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  entry: QueueItemWithStart;
  timeFormat: TimeFormat;
  countdownMs: number | null;
  isFirst: boolean;
  isLast: boolean;
  moveDisabled: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
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
          <span>
            {formatTimeOfDay(entry.expectedStartAt, timeFormat)}
            {isFirst && countdownMs !== null && (
              <span className="ml-2 text-xs tabular-nums text-slate-400">(in {formatDuration(countdownMs)})</span>
            )}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 font-medium text-slate-900">
        {entry.title}
        {entry.artist && <span className="ml-2 font-normal text-slate-500">{entry.artist}</span>}
      </td>
      <td className="px-4 py-3">
        <MediaKindBadge kind={entry.mediaKind} />
      </td>
      <td className="px-4 py-3 text-slate-600">{formatDuration(entry.durationMs)}</td>
      <td className="px-4 py-3">
        {/* Stops the drag listeners above from swallowing plain button clicks. */}
        <div className="flex justify-end gap-2" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst || moveDisabled}
            aria-label="Move up"
            title="Move up"
            className={rowActionButton}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast || moveDisabled}
            aria-label="Move down"
            title="Move down"
            className={rowActionButton}
          >
            ↓
          </button>
          <button type="button" onClick={onRemove} className={rowActionButtonDanger}>
            Remove
          </button>
        </div>
      </td>
    </tr>
  );
}
