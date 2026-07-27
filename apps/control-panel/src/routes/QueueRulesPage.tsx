import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SeparationRulesDTO, StationSettingsDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { ComingSoon } from "../components/ComingSoon";
import { formatDateTime } from "../lib/format";
import { useTimeFormat } from "../lib/useTimeFormat";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

const STATION_KEY = ["settings", "station"];

function QueuePlanningSection() {
  const timeFormat = useTimeFormat();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: STATION_KEY,
    queryFn: () => apiClient.get<StationSettingsDTO>("/settings/station"),
  });

  const [horizonMinutes, setHorizonMinutes] = useState(240);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.data) return;
    setHorizonMinutes(query.data.queuePlanningHorizonMinutes);
  }, [query.data]);

  const updateMutation = useMutation({
    mutationFn: (minutes: number) =>
      apiClient.patch<StationSettingsDTO>("/settings/station", {
        queuePlanningHorizonMinutes: String(minutes),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STATION_KEY });
      showToast("success", "Queue planning saved");
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : "Update failed";
      setError(message);
      showToast("error", `Couldn't save queue planning: ${message}`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    updateMutation.mutate(horizonMinutes);
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Queue Planning</h2>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {query.isError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load queue planning: {(query.error as Error).message}
        </div>
      )}

      {query.data && (
        <form onSubmit={handleSubmit}>
          <label>
            <span className={labelClass}>Plan the queue ahead by (minutes)</span>
            <input
              type="number"
              min={1}
              value={horizonMinutes}
              onChange={(e) => setHorizonMinutes(Number(e.target.value))}
              className={`max-w-xs ${inputClass}`}
            />
          </label>
          <p className="mt-1 text-xs text-slate-400">
            How far ahead the clock wheel keeps the queue filled -- e.g. 240 = 4 hours.
          </p>

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

function CrossfadeDefaultsSection() {
  const timeFormat = useTimeFormat();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: STATION_KEY,
    queryFn: () => apiClient.get<StationSettingsDTO>("/settings/station"),
  });

  const [mixInSeconds, setMixInSeconds] = useState(5);
  const [mixOutSeconds, setMixOutSeconds] = useState(5);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.data) return;
    setMixInSeconds(query.data.defaultMixInDurationMs / 1000);
    setMixOutSeconds(query.data.defaultMixOutDurationMs / 1000);
  }, [query.data]);

  const updateMutation = useMutation({
    mutationFn: (payload: { defaultMixInDurationMs: number; defaultMixOutDurationMs: number }) =>
      apiClient.patch<StationSettingsDTO>("/settings/station", {
        defaultMixInDurationMs: String(payload.defaultMixInDurationMs),
        defaultMixOutDurationMs: String(payload.defaultMixOutDurationMs),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STATION_KEY });
      showToast("success", "Crossfade defaults saved");
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : "Update failed";
      setError(message);
      showToast("error", `Couldn't save crossfade defaults: ${message}`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    updateMutation.mutate({
      defaultMixInDurationMs: Math.round(mixInSeconds * 1000),
      defaultMixOutDurationMs: Math.round(mixOutSeconds * 1000),
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">Crossfade Defaults</h2>
      <p className="mb-4 text-xs text-slate-500">
        How long consecutive songs blend into each other when a song doesn't set its own mix-in/mix-out points
        (see the Mix Points section of a song's editor).
      </p>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {query.isError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load crossfade defaults: {(query.error as Error).message}
        </div>
      )}

      {query.data && (
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-4">
            <label>
              <span className={labelClass}>Default mix-in (seconds)</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={mixInSeconds}
                onChange={(e) => setMixInSeconds(Number(e.target.value))}
                className={inputClass}
              />
            </label>
            <label>
              <span className={labelClass}>Default mix-out (seconds)</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={mixOutSeconds}
                onChange={(e) => setMixOutSeconds(Number(e.target.value))}
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

function SeparationRulesSection() {
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
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">Separation Rules</h2>
      <p className="mb-4 text-xs text-slate-500">
        Minimum time before the clock-wheel rotation is allowed to repeat the same artist, album, or exact track.
      </p>

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
        <form onSubmit={handleSubmit}>
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

export function QueueRulesPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Queue Rules</h1>

      <div className="flex max-w-md flex-col gap-6">
        <QueuePlanningSection />
        <CrossfadeDefaultsSection />
        <SeparationRulesSection />
      </div>
    </div>
  );
}
