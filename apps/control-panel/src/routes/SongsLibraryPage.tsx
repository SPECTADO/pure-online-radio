import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ALL_CATEGORY_NAME, type BatchCategoryAction, type BatchResultDTO, type CategoryDTO, type SongDTO } from "@spectado/shared-types";
import { apiClient, apiUrl, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { useAudioPreviewStore } from "../lib/audioPreviewStore";
import { useAddToQueue } from "../lib/useAddToQueue";
import { rowActionButton, rowActionButtonDanger } from "../lib/buttonStyles";
import { ComingSoon } from "../components/ComingSoon";
import { Modal } from "../components/Modal";
import { PreviewButton } from "../components/PreviewButton";
import { SongUploadModal } from "../components/SongUploadModal";
import { SongEditModal } from "../components/SongEditModal";
import { formatDateTime, formatDuration } from "../lib/format";
import { useTimeFormat } from "../lib/useTimeFormat";

const selectClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

type StatusFilter = "all" | "active" | "inactive";
type SortKey = "title" | "artist" | "album" | "duration" | "plays" | "lastPlayed";
type SortDir = "asc" | "desc";

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th className="px-4 py-3">
      <button type="button" onClick={onClick} className="flex items-center gap-1 hover:text-slate-700">
        {label}
        <span aria-hidden="true" className={active ? "text-slate-600" : "text-slate-300"}>
          {dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

function BatchCategoryModal({
  categories,
  pending,
  onApply,
  onClose,
}: {
  categories: CategoryDTO[];
  pending: boolean;
  onApply: (categoryId: string, action: BatchCategoryAction) => void;
  onClose: () => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [action, setAction] = useState<BatchCategoryAction>("add");
  const assignableCategories = categories.filter((c) => c.name !== ALL_CATEGORY_NAME);

  return (
    <Modal title="Add/remove category" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAction("add")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${
              action === "add" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            Add to selected
          </button>
          <button
            type="button"
            onClick={() => setAction("remove")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${
              action === "remove" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            Remove from selected
          </button>
        </div>

        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectClass}>
          <option value="">Select a category…</option>
          {assignableCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!categoryId || pending}
          onClick={() => onApply(categoryId, action)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Applying…" : "Apply"}
        </button>
      </div>
    </Modal>
  );
}

export function SongsLibraryPage() {
  const timeFormat = useTimeFormat();
  const queryClient = useQueryClient();
  const stopPreview = useAudioPreviewStore((s) => s.stop);
  const addToQueue = useAddToQueue();
  const query = useQuery({
    queryKey: ["library", "songs"],
    queryFn: () => apiClient.get<SongDTO[]>("/library/songs"),
    retry: false,
  });
  const categoriesQuery = useQuery({
    queryKey: ["library", "categories"],
    queryFn: () => apiClient.get<CategoryDTO[]>("/library/categories"),
  });

  const [showUpload, setShowUpload] = useState(false);
  const [editing, setEditing] = useState<SongDTO | null>(null);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchCategory, setShowBatchCategory] = useState(false);
  const [showBatchDelete, setShowBatchDelete] = useState(false);

  // A preview started on this page shouldn't keep playing after navigating away.
  useEffect(() => stopPreview, [stopPreview]);

  // Selections refer to currently-visible rows -- reset whenever the filters change so a
  // hidden, still-"selected" song can't be silently included in a later batch action.
  useEffect(() => setSelectedIds(new Set()), [search, categoryFilter, statusFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (query.data ?? []).filter((song) => {
      if (statusFilter === "active" && !song.isActive) return false;
      if (statusFilter === "inactive" && song.isActive) return false;
      if (categoryFilter && !song.categories.some((c) => c.id === categoryFilter)) return false;
      if (q) {
        const haystack = `${song.title} ${song.artist} ${song.album ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [query.data, search, categoryFilter, statusFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "title":
          return a.title.localeCompare(b.title) * dir;
        case "artist":
          return a.artist.localeCompare(b.artist) * dir;
        case "album":
          return (a.album ?? "").localeCompare(b.album ?? "") * dir;
        case "duration":
          return (a.durationMs - b.durationMs) * dir;
        case "plays":
          return (a.playCount - b.playCount) * dir;
        case "lastPlayed": {
          // Never-played songs always sort last, in either direction.
          if (a.lastPlayedAt === null && b.lastPlayedAt === null) return 0;
          if (a.lastPlayedAt === null) return 1;
          if (b.lastPlayedAt === null) return -1;
          return (new Date(a.lastPlayedAt).getTime() - new Date(b.lastPlayedAt).getTime()) * dir;
        }
        default:
          return 0;
      }
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((current) => (current.size === sorted.length ? new Set() : new Set(sorted.map((s) => s.id))));
  }

  const hasAnyFilter = search.trim() !== "" || categoryFilter !== "" || statusFilter !== "all";

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => apiClient.post<BatchResultDTO>("/library/songs/batch-delete", { ids }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["library", "songs"] });
      showToast("success", `Deleted ${result.count} song${result.count === 1 ? "" : "s"}`);
      setSelectedIds(new Set());
      setShowBatchDelete(false);
    },
    onError: (err) => {
      showToast(
        "error",
        `Couldn't delete the selected songs: ${err instanceof ApiError ? err.message : "request failed"}`,
      );
    },
  });

  const batchCategoryMutation = useMutation({
    mutationFn: ({ ids, categoryId, action }: { ids: string[]; categoryId: string; action: BatchCategoryAction }) =>
      apiClient.post<BatchResultDTO>("/library/songs/batch-category", { ids, categoryId, action }),
    onSuccess: (result, { action }) => {
      queryClient.invalidateQueries({ queryKey: ["library", "songs"] });
      showToast("success", `${action === "add" ? "Added category to" : "Removed category from"} ${result.count} song${result.count === 1 ? "" : "s"}`);
      setSelectedIds(new Set());
      setShowBatchCategory(false);
    },
    onError: (err) => {
      showToast(
        "error",
        `Couldn't update categories: ${err instanceof ApiError ? err.message : "request failed"}`,
      );
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Songs Library</h1>
        <button
          type="button"
          onClick={() => setShowUpload(true)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Upload song
        </button>
      </div>

      {query.data && query.data.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, artist, album…"
            className={`${selectClass} min-w-[16rem] flex-1`}
          />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className={selectClass}
          >
            <option value="">All categories</option>
            {(categoriesQuery.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className={selectClass}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      )}

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {query.isError && !(query.error instanceof ApiError && query.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load the songs library: {(query.error as Error).message}
        </div>
      )}

      {query.data && query.data.length === 0 && (
        <ComingSoon title="No songs yet" detail="Upload some tracks to see them listed here." />
      )}

      {query.data && query.data.length > 0 && sorted.length === 0 && (
        <ComingSoon title="No matching songs" detail="Try a different search term or filter." />
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm">
          <span className="font-medium text-slate-700">{selectedIds.size} selected</span>
          <button type="button" onClick={() => setShowBatchCategory(true)} className={rowActionButton}>
            Add/remove category
          </button>
          <button type="button" onClick={() => setShowBatchDelete(true)} className={rowActionButtonDanger}>
            Delete selected
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-slate-400 hover:text-slate-600 hover:underline"
          >
            Clear selection
          </button>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="w-8 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === sorted.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-4 py-3" />
                <th className="px-4 py-3" />
                <SortHeader label="Title" active={sortKey === "title"} dir={sortDir} onClick={() => toggleSort("title")} />
                <SortHeader label="Artist" active={sortKey === "artist"} dir={sortDir} onClick={() => toggleSort("artist")} />
                <SortHeader label="Album" active={sortKey === "album"} dir={sortDir} onClick={() => toggleSort("album")} />
                <th className="px-4 py-3">Categories</th>
                <SortHeader label="Duration" active={sortKey === "duration"} dir={sortDir} onClick={() => toggleSort("duration")} />
                <SortHeader label="Plays" active={sortKey === "plays"} dir={sortDir} onClick={() => toggleSort("plays")} />
                <SortHeader
                  label="Last played"
                  active={sortKey === "lastPlayed"}
                  dir={sortDir}
                  onClick={() => toggleSort("lastPlayed")}
                />
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((song) => (
                <tr key={song.id} className={selectedIds.has(song.id) ? "bg-slate-50" : undefined}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(song.id)}
                      onChange={() => toggleSelect(song.id)}
                      aria-label={`Select ${song.title}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <PreviewButton id={song.id} path={`/library/songs/${song.id}/audio`} />
                  </td>
                  <td className="px-4 py-3">
                    {song.coverArtUrl ? (
                      <img src={apiUrl(song.coverArtUrl)} alt="" className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded bg-slate-100" />
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{song.title}</td>
                  <td className="px-4 py-3 text-slate-600">{song.artist}</td>
                  <td className="px-4 py-3 text-slate-600">{song.album ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="flex flex-wrap gap-1">
                      {song.categories.map((c) => (
                        <span key={c.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDuration(song.durationMs)}</td>
                  <td className="px-4 py-3 text-slate-600">{song.playCount}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {song.lastPlayedAt ? formatDateTime(song.lastPlayedAt, timeFormat) : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    {song.isActive ? (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                        active
                      </span>
                    ) : (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => addToQueue.mutate({ mediaKind: "SONG", mediaId: song.id, title: song.title })}
                        className={rowActionButton}
                      >
                        Add to queue
                      </button>
                      <button type="button" onClick={() => setEditing(song)} className={rowActionButton}>
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasAnyFilter && (
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
              Showing {sorted.length} of {query.data?.length ?? 0} songs
            </div>
          )}
        </div>
      )}

      {showUpload && <SongUploadModal onClose={() => setShowUpload(false)} />}
      {editing && <SongEditModal song={editing} onClose={() => setEditing(null)} />}

      {showBatchCategory && (
        <BatchCategoryModal
          categories={categoriesQuery.data ?? []}
          pending={batchCategoryMutation.isPending}
          onApply={(categoryId, action) =>
            batchCategoryMutation.mutate({ ids: [...selectedIds], categoryId, action })
          }
          onClose={() => setShowBatchCategory(false)}
        />
      )}

      {showBatchDelete && (
        <Modal title="Delete songs" onClose={() => setShowBatchDelete(false)}>
          <p className="text-sm text-slate-600">
            Delete {selectedIds.size} song{selectedIds.size === 1 ? "" : "s"}? This removes the audio files and
            cover art permanently.
          </p>
          {batchDeleteMutation.isError && (
            <p className="mt-2 text-sm text-red-600">
              {batchDeleteMutation.error instanceof Error ? batchDeleteMutation.error.message : "Delete failed"}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowBatchDelete(false)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => batchDeleteMutation.mutate([...selectedIds])}
              disabled={batchDeleteMutation.isPending}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {batchDeleteMutation.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
