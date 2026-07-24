import { useQuery } from "@tanstack/react-query";
import type { SongDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { ComingSoon } from "../components/ComingSoon";
import { formatDuration } from "../lib/format";

export function SongsLibraryPage() {
  const query = useQuery({
    queryKey: ["library", "songs"],
    queryFn: () => apiClient.get<SongDTO[]>("/library/songs"),
    retry: false,
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Songs Library</h1>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {query.isError && query.error instanceof ApiError && query.error.isNotImplemented && (
        <ComingSoon
          title="Songs library"
          detail="The song library API isn't implemented yet. Once it is, uploaded tracks will show up here."
        />
      )}

      {query.isError && !(query.error instanceof ApiError && query.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load the songs library: {(query.error as Error).message}
        </div>
      )}

      {query.data && query.data.length === 0 && (
        <ComingSoon title="No songs yet" detail="Upload some tracks to see them listed here." />
      )}

      {query.data && query.data.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Artist</th>
                <th className="px-4 py-3">Album</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Plays</th>
                <th className="px-4 py-3">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {query.data.map((song) => (
                <tr key={song.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{song.title}</td>
                  <td className="px-4 py-3 text-slate-600">{song.artist}</td>
                  <td className="px-4 py-3 text-slate-600">{song.album ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{song.category?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDuration(song.durationMs)}</td>
                  <td className="px-4 py-3 text-slate-600">{song.playCount}</td>
                  <td className="px-4 py-3">
                    {song.isActive ? (
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
