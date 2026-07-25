import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { useAudioPreviewStore } from "../lib/audioPreviewStore";
import { useAddToQueue } from "../lib/useAddToQueue";
import { rowActionButton, rowActionButtonDanger } from "../lib/buttonStyles";
import { ComingSoon } from "../components/ComingSoon";
import { Modal } from "../components/Modal";
import { PreviewButton } from "../components/PreviewButton";
import { AdUploadModal } from "../components/AdUploadModal";
import { AdEditModal } from "../components/AdEditModal";
import { formatDateTime, formatDuration } from "../lib/format";
import { useTimeFormat } from "../lib/useTimeFormat";

const selectClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

type AdStatus = "disabled" | "upcoming" | "active" | "expired";
type StatusFilter = "all" | AdStatus;

function getAdStatus(ad: AdDTO): AdStatus {
  if (!ad.isActive) return "disabled";
  const now = Date.now();
  if (now < new Date(ad.activeFrom).getTime()) return "upcoming";
  if (now > new Date(ad.activeUntil).getTime()) return "expired";
  return "active";
}

const STATUS_BADGE_STYLES: Record<AdStatus, string> = {
  disabled: "bg-slate-100 text-slate-500",
  upcoming: "bg-amber-50 text-amber-700",
  expired: "bg-slate-100 text-slate-500",
  active: "bg-emerald-50 text-emerald-700",
};

const STATUS_BADGE_LABELS: Record<AdStatus, string> = {
  disabled: "disabled",
  upcoming: "upcoming",
  expired: "expired",
  active: "active now",
};

function AdStatusBadge({ ad }: { ad: AdDTO }) {
  const status = getAdStatus(ad);
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_BADGE_STYLES[status]}`}>
      {STATUS_BADGE_LABELS[status]}
    </span>
  );
}

export function AdsLibraryPage() {
  const queryClient = useQueryClient();
  const stopPreview = useAudioPreviewStore((s) => s.stop);
  const addToQueue = useAddToQueue();
  const timeFormat = useTimeFormat();
  const query = useQuery({
    queryKey: ["library", "ads"],
    queryFn: () => apiClient.get<AdDTO[]>("/library/ads"),
    retry: false,
  });

  const [showUpload, setShowUpload] = useState(false);
  const [editing, setEditing] = useState<AdDTO | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdDTO | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => stopPreview, [stopPreview]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (query.data ?? []).filter((ad) => {
      if (statusFilter !== "all" && getAdStatus(ad) !== statusFilter) return false;
      if (q && !ad.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [query.data, search, statusFilter]);

  const hasAnyFilter = search.trim() !== "" || statusFilter !== "all";

  const deleteMutation = useMutation({
    mutationFn: (ad: AdDTO) => apiClient.delete(`/library/ads/${ad.id}`),
    onSuccess: (_data, ad) => {
      queryClient.invalidateQueries({ queryKey: ["library", "ads"] });
      showToast("success", `Deleted "${ad.title}"`);
      setPendingDelete(null);
    },
    onError: (err, ad) => {
      showToast("error", `Couldn't delete "${ad.title}": ${err instanceof ApiError ? err.message : "Delete failed"}`);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Ads Library</h1>
        <button
          type="button"
          onClick={() => setShowUpload(true)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Upload ad
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
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className={selectClass}
          >
            <option value="all">All statuses</option>
            <option value="active">Active now</option>
            <option value="upcoming">Upcoming</option>
            <option value="expired">Expired</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      )}

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {query.isError && !(query.error instanceof ApiError && query.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load the ads library: {(query.error as Error).message}
        </div>
      )}

      {query.data && query.data.length === 0 && (
        <ComingSoon title="No ads yet" detail="Upload an ad and set its active window to see it listed here." />
      )}

      {query.data && query.data.length > 0 && filtered.length === 0 && (
        <ComingSoon title="No matching ads" detail="Try a different search term or filter." />
      )}

      {filtered.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3" />
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Active from</th>
                <th className="px-4 py-3">Active until</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((ad) => (
                <tr key={ad.id}>
                  <td className="px-4 py-3">
                    <PreviewButton id={ad.id} path={`/library/ads/${ad.id}/audio`} />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{ad.title}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(ad.activeFrom, timeFormat)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(ad.activeUntil, timeFormat)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDuration(ad.durationMs)}</td>
                  <td className="px-4 py-3">
                    <AdStatusBadge ad={ad} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => addToQueue.mutate({ mediaKind: "AD", mediaId: ad.id, title: ad.title })}
                        className={rowActionButton}
                      >
                        Add to queue
                      </button>
                      <button type="button" onClick={() => setEditing(ad)} className={rowActionButton}>
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(ad)}
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
              Showing {filtered.length} of {query.data?.length ?? 0} ads
            </div>
          )}
        </div>
      )}

      {showUpload && <AdUploadModal onClose={() => setShowUpload(false)} />}
      {editing && <AdEditModal ad={editing} onClose={() => setEditing(null)} />}

      {pendingDelete && (
        <Modal title="Delete ad" onClose={() => setPendingDelete(null)}>
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
