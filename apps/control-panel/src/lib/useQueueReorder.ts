import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { QueueEntryDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "./apiClient";
import { showToast } from "./toastStore";

const QUEUE_KEY = ["queue"];

export type ReorderScope = "manual" | "rotation";

const isDue = (item: QueueEntryDTO) => item.scheduledFor !== null && item.clockWheelName === null;
const isManual = (item: QueueEntryDTO) => item.scheduledFor === null;
const isRotation = (item: QueueEntryDTO) => item.scheduledFor !== null && item.clockWheelName !== null;

/**
 * Drag-and-drop reordering shared by the Queue page and the Dashboard's Up Next section.
 * Manual (unscheduled) items and clock-wheel rotation fills are each independently
 * reorderable (within their own pool only -- see the reorder endpoint's `scope`); due
 * schedule-fired items and not-yet-fired trigger previews are read-only.
 */
export function useQueueReorder(queueEntries: QueueEntryDTO[]) {
  const queryClient = useQueryClient();

  const manualEntries = useMemo(() => queueEntries.filter(isManual), [queueEntries]);
  const rotationEntries = useMemo(() => queueEntries.filter(isRotation), [queueEntries]);

  const reorderMutation = useMutation({
    mutationFn: ({ scope, orderedIds }: { scope: ReorderScope; orderedIds: string[] }) =>
      apiClient.patch("/queue/items/reorder", { scope, orderedIds }),
    // Reorder the cached list immediately so a drag-drop lands exactly where it was dropped
    // instead of snapping back until the request round-trips. The cache also holds due
    // (scheduledFor set, not clock-wheel) items, which are never part of `orderedIds` -- keep
    // those in place and only rewrite the pool (manual or rotation) actually being reordered,
    // reassembled in the same [due, manual, rotation] order the server itself returns.
    onMutate: async ({ scope, orderedIds }) => {
      await queryClient.cancelQueries({ queryKey: QUEUE_KEY });
      const previous = queryClient.getQueryData<QueueEntryDTO[]>(QUEUE_KEY);
      if (previous) {
        const due = previous.filter(isDue);
        const manual = previous.filter(isManual);
        const rotation = previous.filter(isRotation);
        const pool = scope === "manual" ? manual : rotation;
        const poolById = new Map(pool.map((item) => [item.id, item]));
        const reorderedPool = orderedIds
          .map((id) => poolById.get(id))
          .filter((item): item is QueueEntryDTO => item !== undefined);
        queryClient.setQueryData<QueueEntryDTO[]>(
          QUEUE_KEY,
          scope === "manual" ? [...due, ...reorderedPool, ...rotation] : [...due, ...manual, ...reorderedPool],
        );
      }
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(QUEUE_KEY, context.previous);
      showToast(
        "error",
        `Couldn't reorder the queue: ${err instanceof ApiError ? err.message : "request failed"}`,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUEUE_KEY }),
  });

  function reorderTo(scope: ReorderScope, items: QueueEntryDTO[], fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || toIndex >= items.length) return;
    reorderMutation.mutate({ scope, orderedIds: arrayMove(items, fromIndex, toIndex).map((item) => item.id) });
  }

  const sensors = useSensors(
    // Requires a small drag before activating, so a plain click on the row
    // (or on the remove button) doesn't get swallowed as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const allEntries = [...manualEntries, ...rotationEntries];
    const activeEntry = allEntries.find((item) => item.id === active.id);
    const overEntry = allEntries.find((item) => item.id === over.id);
    if (!activeEntry || !overEntry) return;

    // Dragging across pools (manual <-> rotation) is a no-op -- the claim priority between
    // them is fixed regardless of position, so "moving" a rotation item above a manual one
    // wouldn't actually change playback order and would just be misleading.
    const activeScope: ReorderScope = isManual(activeEntry) ? "manual" : "rotation";
    const overScope: ReorderScope = isManual(overEntry) ? "manual" : "rotation";
    if (activeScope !== overScope) return;

    const poolEntries = activeScope === "manual" ? manualEntries : rotationEntries;
    const oldIndex = poolEntries.findIndex((item) => item.id === active.id);
    const newIndex = poolEntries.findIndex((item) => item.id === over.id);
    reorderTo(activeScope, poolEntries, oldIndex, newIndex);
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  return {
    manualEntries,
    rotationEntries,
    sensors,
    activeId,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  };
}
