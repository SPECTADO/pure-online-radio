import { useQuery } from "@tanstack/react-query";
import type { QueueEntryDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { ComingSoon } from "../components/ComingSoon";
import { formatDateTime } from "../lib/format";

export function QueuePage() {
  const query = useQuery({
    queryKey: ["queue"],
    queryFn: () => apiClient.get<QueueEntryDTO[]>("/queue"),
    retry: false,
    refetchInterval: 10_000,
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Queue</h1>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {query.isError && query.error instanceof ApiError && query.error.isNotImplemented && (
        <ComingSoon
          title="Manual queue"
          detail="Queueing one-off tracks and jingles isn't implemented yet."
        />
      )}

      {query.isError && !(query.error instanceof ApiError && query.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load the queue: {(query.error as Error).message}
        </div>
      )}

      {query.data && query.data.length === 0 && (
        <ComingSoon title="Queue is empty" detail="Items added to the manual queue appear here." />
      )}

      {query.data && query.data.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Media</th>
                <th className="px-4 py-3">Scheduled for</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {query.data.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {entry.mediaKind} <span className="text-slate-400">#{entry.mediaId}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {entry.scheduledFor ? formatDateTime(entry.scheduledFor) : "as soon as due"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{entry.status}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(entry.addedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
