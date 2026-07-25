import { useQuery } from "@tanstack/react-query";
import type { SeparationRulesDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { ComingSoon } from "../components/ComingSoon";
import { formatDateTime } from "../lib/format";
import { useTimeFormat } from "../lib/useTimeFormat";

export function SeparationRulesPage() {
  const timeFormat = useTimeFormat();
  const query = useQuery({
    queryKey: ["settings", "separation-rules"],
    queryFn: () => apiClient.get<SeparationRulesDTO>("/settings/separation-rules"),
    retry: false,
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Separation Rules</h1>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {query.isError && query.error instanceof ApiError && query.error.isNotImplemented && (
        <ComingSoon
          title="Separation rules"
          detail="Artist/song separation settings aren't implemented yet."
        />
      )}

      {query.isError && !(query.error instanceof ApiError && query.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load separation rules: {(query.error as Error).message}
        </div>
      )}

      {query.data && (
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6">
          <dl className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500">Artist separation</dt>
              <dd className="text-sm font-medium text-slate-900">
                {query.data.artistSeparationMinutes} minutes
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500">Song separation</dt>
              <dd className="text-sm font-medium text-slate-900">
                {query.data.songSeparationMinutes} minutes
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <dt className="text-xs text-slate-400">Last updated</dt>
              <dd className="text-xs text-slate-400">{formatDateTime(query.data.updatedAt, timeFormat)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-slate-400">
            Editing these rules isn't available yet — this is a read-only view.
          </p>
        </div>
      )}
    </div>
  );
}
