import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AdDTO, JingleDTO, MediaKind, SongDTO } from "@spectado/shared-types";
import { apiClient } from "../lib/apiClient";
import { formatDuration } from "../lib/format";
import { MediaKindBadge } from "./MediaKindBadge";

const MAX_SEARCH_RESULTS = 10;

/** Client-side only -- `key` is a stable id for dnd-kit/list rendering, never sent to the
 * API (only mediaKind/mediaId are). */
export interface PickedScheduleItem {
  key: string;
  mediaKind: MediaKind;
  mediaId: string;
  title: string;
  artist: string | null;
  durationMs: number;
}

interface SearchResult {
  mediaKind: MediaKind;
  id: string;
  title: string;
  subtitle: string | null;
  durationMs: number;
}

/** Ordered song/jingle/ad picker for a schedule-rule block: search-and-add (all 3 media
 * kinds, unlike QuickAddSection which is songs/jingles only) plus drag-to-reorder,
 * mirroring QueuePage's dnd-kit reorder pattern. */
export function ScheduleItemPicker({
  items,
  onChange,
}: {
  items: PickedScheduleItem[];
  onChange: (items: PickedScheduleItem[]) => void;
}) {
  const [search, setSearch] = useState("");

  const songsQuery = useQuery({ queryKey: ["library", "songs"], queryFn: () => apiClient.get<SongDTO[]>("/library/songs") });
  const jinglesQuery = useQuery({
    queryKey: ["library", "jingles"],
    queryFn: () => apiClient.get<JingleDTO[]>("/library/jingles"),
  });
  const adsQuery = useQuery({ queryKey: ["library", "ads"], queryFn: () => apiClient.get<AdDTO[]>("/library/ads") });

  const results = useMemo<SearchResult[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];

    const songResults: SearchResult[] = (songsQuery.data ?? [])
      .filter((s) => s.isActive && `${s.title} ${s.artist}`.toLowerCase().includes(q))
      .map((s) => ({ mediaKind: "SONG", id: s.id, title: s.title, subtitle: s.artist, durationMs: s.durationMs }));
    const jingleResults: SearchResult[] = (jinglesQuery.data ?? [])
      .filter((j) => j.isActive && j.title.toLowerCase().includes(q))
      .map((j) => ({ mediaKind: "JINGLE", id: j.id, title: j.title, subtitle: null, durationMs: j.durationMs }));
    const adResults: SearchResult[] = (adsQuery.data ?? [])
      .filter((a) => a.isActive && a.title.toLowerCase().includes(q))
      .map((a) => ({ mediaKind: "AD", id: a.id, title: a.title, subtitle: null, durationMs: a.durationMs }));

    return [...songResults, ...jingleResults, ...adResults].slice(0, MAX_SEARCH_RESULTS);
  }, [songsQuery.data, jinglesQuery.data, adsQuery.data, search]);

  function addResult(result: SearchResult) {
    onChange([
      ...items,
      {
        key: crypto.randomUUID(),
        mediaKind: result.mediaKind,
        mediaId: result.id,
        title: result.title,
        artist: result.subtitle,
        durationMs: result.durationMs,
      },
    ]);
    setSearch("");
  }

  function removeItem(key: string) {
    onChange(items.filter((item) => item.key !== key));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((item) => item.key === active.id);
    const newIndex = items.findIndex((item) => item.key === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onChange(arrayMove(items, oldIndex, newIndex));
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search songs, jingles, and ads by title…"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />

      {search.trim() !== "" && (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-100">
          {results.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">No matches found.</p>}
          {results.map((result) => (
            <div
              key={`${result.mediaKind}-${result.id}`}
              className="flex items-center justify-between gap-3 px-4 py-2"
            >
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
              <button
                type="button"
                onClick={() => addResult(result)}
                className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Add
              </button>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No items yet -- search above to add songs, jingles, or ads.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200">
              {items.map((item) => (
                <PickedItemRow key={item.key} item={item} onRemove={() => removeItem(item.key)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function PickedItemRow({ item, onRemove }: { item: PickedScheduleItem; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`flex cursor-grab touch-none select-none items-center justify-between gap-3 bg-white px-4 py-2 active:cursor-grabbing ${
        isDragging ? "relative z-10 opacity-50" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="text-slate-300">
          ⠿
        </span>
        <MediaKindBadge kind={item.mediaKind} />
        <span className="truncate text-sm font-medium text-slate-900">{item.title}</span>
        {item.artist && <span className="truncate text-xs text-slate-500">{item.artist}</span>}
        <span className="shrink-0 text-xs text-slate-400">{formatDuration(item.durationMs)}</span>
      </div>
      <div onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          Remove
        </button>
      </div>
    </li>
  );
}
