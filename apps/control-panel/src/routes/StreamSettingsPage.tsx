import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StreamCodec, StreamSettingsDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { formatDateTime, formatUptime } from "../lib/format";
import { useTimeFormat } from "../lib/useTimeFormat";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

const STREAM_SETTINGS_KEY = ["settings", "stream"];

const CODECS: StreamCodec[] = ["AAC", "MP3"];

export function StreamSettingsPage() {
  const timeFormat = useTimeFormat();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: STREAM_SETTINGS_KEY,
    queryFn: () => apiClient.get<StreamSettingsDTO>("/settings/stream"),
  });

  const [codec, setCodec] = useState<StreamCodec>("AAC");
  const [lowBitrateKbps, setLowBitrateKbps] = useState(64);
  const [highBitrateKbps, setHighBitrateKbps] = useState(256);
  const [segmentSeconds, setSegmentSeconds] = useState(4);
  const [segmentCount, setSegmentCount] = useState(8);
  const [lowLatencyEnabled, setLowLatencyEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed local form state once the current settings load -- same singleton-settings-form
  // pattern as StationSettingsPage/QueueRulesPage (fetched once, not a list of
  // independently-editable rows).
  useEffect(() => {
    if (!query.data) return;
    setCodec(query.data.codec);
    setLowBitrateKbps(query.data.lowBitrateKbps);
    setHighBitrateKbps(query.data.highBitrateKbps);
    setSegmentSeconds(query.data.segmentSeconds);
    setSegmentCount(query.data.segmentCount);
    setLowLatencyEnabled(query.data.lowLatencyEnabled);
  }, [query.data]);

  const updateMutation = useMutation({
    mutationFn: (payload: Omit<StreamSettingsDTO, "updatedAt">) =>
      apiClient.patch<StreamSettingsDTO>("/settings/stream", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STREAM_SETTINGS_KEY });
      showToast("success", "Stream settings saved — restart the encoder to apply");
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : "Update failed";
      setError(message);
      showToast("error", `Couldn't save stream settings: ${message}`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    updateMutation.mutate({
      codec,
      lowBitrateKbps,
      highBitrateKbps,
      segmentSeconds,
      segmentCount,
      lowLatencyEnabled,
    });
  }

  const timeShiftWindowSeconds = segmentSeconds * segmentCount;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Stream Settings</h1>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {query.isError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load stream settings: {(query.error as Error).message}
        </div>
      )}

      {query.data && (
        <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-6">
          <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
            The encoder reads these settings once at boot -- changes here only take effect the
            next time the encoder process restarts (e.g. <code>docker compose restart encoder</code>).
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Codec &amp; Bitrate
            </h2>

            <div className="flex flex-col gap-4">
              <label>
                <span className={labelClass}>Codec</span>
                <select
                  value={codec}
                  onChange={(e) => setCodec(e.target.value as StreamCodec)}
                  className={inputClass}
                >
                  {CODECS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">Used by both stream variants below.</p>
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label>
                  <span className={labelClass}>Low bitrate (kbps)</span>
                  <input
                    type="number"
                    min={32}
                    max={320}
                    value={lowBitrateKbps}
                    onChange={(e) => setLowBitrateKbps(Number(e.target.value))}
                    className={inputClass}
                  />
                </label>
                <label>
                  <span className={labelClass}>High bitrate (kbps)</span>
                  <input
                    type="number"
                    min={32}
                    max={320}
                    value={highBitrateKbps}
                    onChange={(e) => setHighBitrateKbps(Number(e.target.value))}
                    className={inputClass}
                  />
                </label>
              </div>
              <p className="text-xs text-slate-400">
                The low variant is mixed down to mono/44.1kHz, the high variant kept
                stereo/48kHz -- listeners' players pick whichever fits their connection.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Segments &amp; Time-Shift
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Segment length trades off start-up/seek latency against request overhead; segment
              count controls how far back a listener can rewind (the live-edge/time-shift window).
            </p>

            <div className="grid grid-cols-2 gap-4">
              <label>
                <span className={labelClass}>Segment length (seconds)</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={segmentSeconds}
                  onChange={(e) => setSegmentSeconds(Number(e.target.value))}
                  className={inputClass}
                  disabled={lowLatencyEnabled}
                />
              </label>
              <label>
                <span className={labelClass}>Segment count</span>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={segmentCount}
                  onChange={(e) => setSegmentCount(Number(e.target.value))}
                  className={inputClass}
                />
              </label>
            </div>

            <p className="mt-2 text-xs text-slate-400">
              {lowLatencyEnabled
                ? "Ignored while Low Latency HLS is on (below) -- that mode forces a fixed short segment length."
                : `~${formatUptime(timeShiftWindowSeconds)} time-shift/DVR window at these values.`}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Low Latency HLS
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              ffmpeg's HLS muxer has no true sub-second partial-segment (LL-HLS) support, so this
              forces much shorter full segments and a tighter live-edge window instead (~2-4s
              glass-to-glass instead of the usual ~16-32s) -- still standard, fully compatible HLS.
            </p>

            <div className="flex gap-2">
              {([false, true] as const).map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => setLowLatencyEnabled(value)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    lowLatencyEnabled === value
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {value ? "On" : "Off"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            <span className="text-xs text-slate-400">Last updated {formatDateTime(query.data.updatedAt, timeFormat)}</span>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>

          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </form>
      )}
    </div>
  );
}
