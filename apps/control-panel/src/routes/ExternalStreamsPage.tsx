import { useQuery } from "@tanstack/react-query";
import type { ExternalStreamDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { ComingSoon } from "../components/ComingSoon";
import { formatDateTime } from "../lib/format";
import { useTimeFormat } from "../lib/useTimeFormat";

export function ExternalStreamsPage() {
  const timeFormat = useTimeFormat();
  const query = useQuery({
    queryKey: ["external-streams"],
    queryFn: () => apiClient.get<ExternalStreamDTO[]>("/external-streams"),
    retry: false,
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">External Streams</h1>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {query.isError && query.error instanceof ApiError && query.error.isNotImplemented && (
        <ComingSoon
          title="External streams"
          detail="Relaying an external stream (e.g. a live remote broadcast) isn't implemented yet."
        />
      )}

      {query.isError && !(query.error instanceof ApiError && query.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load external streams: {(query.error as Error).message}
        </div>
      )}

      {query.data && query.data.length === 0 && (
        <ComingSoon
          title="No external streams"
          detail="Scheduled relays of external streams will show up here."
        />
      )}

      {query.data && query.data.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">URL</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">End</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {query.data.map((stream) => (
                <tr key={stream.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{stream.name}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-slate-600">{stream.url}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(stream.startAt, timeFormat)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(stream.endAt, timeFormat)}</td>
                  <td className="px-4 py-3 text-slate-600">{stream.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
