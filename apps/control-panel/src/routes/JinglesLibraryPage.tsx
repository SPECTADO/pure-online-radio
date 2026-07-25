import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CategoryDTO, JingleDTO, JingleType } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { useAudioPreviewStore } from "../lib/audioPreviewStore";
import { useAddToQueue } from "../lib/useAddToQueue";
import { rowActionButton, rowActionButtonDanger } from "../lib/buttonStyles";
import { ComingSoon } from "../components/ComingSoon";
import { Modal } from "../components/Modal";
import { PreviewButton } from "../components/PreviewButton";
import { JingleUploadModal } from "../components/JingleUploadModal";
import { JingleEditModal } from "../components/JingleEditModal";
import { formatDuration } from "../lib/format";

const selectClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

type StatusFilter = "all" | "active" | "inactive";
const JINGLE_TYPES: JingleType[] = ["STATION_ID", "SWEEPER", "SFX", "PROMO", "ADVERT", "OTHER"];

export function JinglesLibraryPage() {
  const queryClient = useQueryClient();
  const stopPreview = useAudioPreviewStore((s) => s.stop);
  const addToQueue = useAddToQueue();
  const query = useQuery({
    queryKey: ["library", "jingles"],
    queryFn: () => apiClient.get<JingleDTO[]>("/library/jingles"),
    retry: false,
  });
  const categoriesQuery = useQuery({
    queryKey: ["library", "categories"],
    queryFn: () => apiClient.get<CategoryDTO[]>("/library/categories"),
  });

  const [showUpload, setShowUpload] = useState(false);
  const [editing, setEditing] = useState<JingleDTO | null>(null);
  const [pendingDelete, setPendingDelete] = useState<JingleDTO | null>(null);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<JingleType | "">("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => stopPreview, [stopPreview]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (query.data ?? []).filter((jingle) => {
      if (statusFilter === "active" && !jingle.isActive) return false;
      if (statusFilter === "inactive" && jingle.isActive) return false;
      if (typeFilter && jingle.type !== typeFilter) return false;
      if (categoryFilter && !jingle.categories.some((c) => c.id === categoryFilter)) return false;
      if (q && !jingle.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [query.data, search, categoryFilter, typeFilter, statusFilter]);

  const hasAnyFilter =
    search.trim() !== "" || categoryFilter !== "" || typeFilter !== "" || statusFilter !== "all";

  const deleteMutation = useMutation({
    mutationFn: (jingle: JingleDTO) => apiClient.delete(`/library/jingles/${jingle.id}`),
    onSuccess: (_data, jingle) => {
      queryClient.invalidateQueries({ queryKey: ["library", "jingles"] });
      showToast("success", `Deleted "${jingle.title}"`);
      setPendingDelete(null);
    },
    onError: (err, jingle) => {
      showToast(
        "error",
        `Couldn't delete "${jingle.title}": ${err instanceof ApiError ? err.message : "Delete failed"}`,
      );
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Jingles Library</h1>
        <button
          type="button"
          onClick={() => setShowUpload(true)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Upload jingle
        </button>
      </div>

      {query.data && query.data.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title…"
            className={`${selectClass} min-w-[16rem] flex-1`}
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as JingleType | "")} className={selectClass}>
            <option value="">All types</option>
            {JINGLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
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
          Couldn't load the jingles library: {(query.error as Error).message}
        </div>
      )}

      {query.data && query.data.length === 0 && (
        <ComingSoon title="No jingles yet" detail="Upload some jingles to see them listed here." />
      )}

      {query.data && query.data.length > 0 && filtered.length === 0 && (
        <ComingSoon title="No matching jingles" detail="Try a different search term or filter." />
      )}

      {filtered.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3" />
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Categories</th>
                <th className="px-4 py-3">Tags</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Plays</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((jingle) => (
                <tr key={jingle.id}>
                  <td className="px-4 py-3">
                    <PreviewButton id={jingle.id} path={`/library/jingles/${jingle.id}/audio`} />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{jingle.title}</td>
                  <td className="px-4 py-3 text-slate-600">{jingle.type}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="flex flex-wrap gap-1">
                      {jingle.categories.map((c) => (
                        <span key={c.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {jingle.tags.length > 0 ? jingle.tags.join(", ") : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDuration(jingle.durationMs)}</td>
                  <td className="px-4 py-3 text-slate-600">{jingle.playCount}</td>
                  <td className="px-4 py-3">
                    {jingle.isActive ? (
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
                        onClick={() => addToQueue.mutate({ mediaKind: "JINGLE", mediaId: jingle.id, title: jingle.title })}
                        className={rowActionButton}
                      >
                        Add to queue
                      </button>
                      <button type="button" onClick={() => setEditing(jingle)} className={rowActionButton}>
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(jingle)}
                        className={rowActionButtonDanger}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasAnyFilter && (
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
              Showing {filtered.length} of {query.data?.length ?? 0} jingles
            </div>
          )}
        </div>
      )}

      {showUpload && <JingleUploadModal onClose={() => setShowUpload(false)} />}
      {editing && <JingleEditModal jingle={editing} onClose={() => setEditing(null)} />}

      {pendingDelete && (
        <Modal title="Delete jingle" onClose={() => setPendingDelete(null)}>
          <p className="text-sm text-slate-600">
            Delete "{pendingDelete.title}"? This removes the audio file permanently.
          </p>
          {deleteMutation.isError && (
            <p className="mt-2 text-sm text-red-600">
              {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Delete failed"}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => deleteMutation.mutate(pendingDelete)}
              disabled={deleteMutation.isPending}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
