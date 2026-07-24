import { useQuery } from "@tanstack/react-query";
import type { JingleDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { ComingSoon } from "../components/ComingSoon";
import { formatDuration } from "../lib/format";

export function JinglesLibraryPage() {
  const query = useQuery({
    queryKey: ["library", "jingles"],
    queryFn: () => apiClient.get<JingleDTO[]>("/library/jingles"),
    retry: false,
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Jingles Library</h1>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {query.isError && query.error instanceof ApiError && query.error.isNotImplemented && (
        <ComingSoon
          title="Jingles library"
          detail="The jingle library API isn't implemented yet. Station IDs, sweepers and promos will show up here."
        />
      )}

      {query.isError && !(query.error instanceof ApiError && query.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load the jingles library: {(query.error as Error).message}
        </div>
      )}

      {query.data && query.data.length === 0 && (
        <ComingSoon title="No jingles yet" detail="Upload some jingles to see them listed here." />
      )}

      {query.data && query.data.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Tags</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Plays</th>
                <th className="px-4 py-3">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {query.data.map((jingle) => (
                <tr key={jingle.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{jingle.title}</td>
                  <td className="px-4 py-3 text-slate-600">{jingle.type}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
