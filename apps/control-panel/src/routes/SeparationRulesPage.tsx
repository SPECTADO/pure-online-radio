import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SeparationRulesDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { ComingSoon } from "../components/ComingSoon";
import { formatDateTime } from "../lib/format";
import { useTimeFormat } from "../lib/useTimeFormat";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export function SeparationRulesPage() {
  const timeFormat = useTimeFormat();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["settings", "separation-rules"],
    queryFn: () => apiClient.get<SeparationRulesDTO>("/settings/separation-rules"),
    retry: false,
  });

  const [artistSeparationMinutes, setArtistSeparationMinutes] = useState(0);
  const [albumSeparationMinutes, setAlbumSeparationMinutes] = useState(0);
  const [songSeparationMinutes, setSongSeparationMinutes] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Seed local form state once the current rules load -- same singleton-settings-form
  // pattern as StationSettingsPage (fetched once, not a list of independently-editable rows).
  useEffect(() => {
    if (!query.data) return;
    setArtistSeparationMinutes(query.data.artistSeparationMinutes);
    setAlbumSeparationMinutes(query.data.albumSeparationMinutes);
    setSongSeparationMinutes(query.data.songSeparationMinutes);
  }, [query.data]);

  const updateMutation = useMutation({
    mutationFn: (payload: { artistSeparationMinutes: number; albumSeparationMinutes: number; songSeparationMinutes: number }) =>
      apiClient.patch<SeparationRulesDTO>("/settings/separation-rules", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "separation-rules"] });
      showToast("success", "Separation rules saved");
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : "Update failed";
      setError(message);
      showToast("error", `Couldn't save separation rules: ${message}`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    updateMutation.mutate({ artistSeparationMinutes, albumSeparationMinutes, songSeparationMinutes });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Separation Rules</h1>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {query.isError && query.error instanceof ApiError && query.error.isNotImplemented && (
        <ComingSoon
          title="Separation rules"
          detail="Artist/album/song separation settings aren't implemented yet."
        />
      )}

      {query.isError && !(query.error instanceof ApiError && query.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load separation rules: {(query.error as Error).message}
        </div>
      )}

      {query.data && (
        <form onSubmit={handleSubmit} className="max-w-md rounded-lg border border-slate-200 bg-white p-6">
          <p className="mb-4 text-xs text-slate-500">
            Minimum time before the clock-wheel rotation is allowed to repeat the same artist, album, or exact
            track.
          </p>

          <div className="flex flex-col gap-4">
            <label>
              <span className={labelClass}>Artist separation (minutes)</span>
              <input
                type="number"
                min={0}
                value={artistSeparationMinutes}
                onChange={(e) => setArtistSeparationMinutes(Number(e.target.value))}
                className={inputClass}
              />
            </label>
            <label>
              <span className={labelClass}>Album separation (minutes)</span>
              <input
                type="number"
                min={0}
                value={albumSeparationMinutes}
                onChange={(e) => setAlbumSeparationMinutes(Number(e.target.value))}
                className={inputClass}
              />
            </label>
            <label>
              <span className={labelClass}>Song separation (minutes)</span>
              <input
                type="number"
                min={0}
                value={songSeparationMinutes}
                onChange={(e) => setSongSeparationMinutes(Number(e.target.value))}
                className={inputClass}
              />
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
            <span className="text-xs text-slate-400">Last updated {formatDateTime(query.data.updatedAt, timeFormat)}</span>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>

          {error && <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </form>
      )}
    </div>
  );
}
