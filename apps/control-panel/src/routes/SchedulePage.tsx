import { useQuery } from "@tanstack/react-query";
import type { QueueEntryDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { ComingSoon } from "../components/ComingSoon";
import { formatDateTime } from "../lib/format";

/** Time-scheduled ("play at/after T") entries — a filtered view over the same
 * shape as the manual queue, surfaced at its own resource route. */
export function SchedulePage() {
  const query = useQuery({
    queryKey: ["schedule"],
    queryFn: () => apiClient.get<QueueEntryDTO[]>("/schedule"),
    retry: false,
  });

  const scheduled = query.data?.filter((entry) => entry.scheduledFor !== null) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Schedule</h1>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {query.isError && query.error instanceof ApiError && query.error.isNotImplemented && (
        <ComingSoon
          title="Schedule"
          detail="Scheduling songs, jingles, and streams for a specific time isn't implemented yet."
        />
      )}

      {query.isError && !(query.error instanceof ApiError && query.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load the schedule: {(query.error as Error).message}
        </div>
      )}

      {query.data && scheduled.length === 0 && (
        <ComingSoon
          title="Nothing scheduled"
          detail="Items scheduled for a specific date and time will show up here."
        />
      )}

      {scheduled.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Media</th>
                <th className="px-4 py-3">Scheduled for</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {scheduled
                .slice()
                .sort((a, b) => (a.scheduledFor! < b.scheduledFor! ? -1 : 1))
                .map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {entry.mediaKind} <span className="text-slate-400">#{entry.mediaId}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDateTime(entry.scheduledFor)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{entry.status}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
