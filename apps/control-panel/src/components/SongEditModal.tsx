import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MetadataSearchResultDTO, SongDTO, StationSettingsDTO } from "@spectado/shared-types";
import { resolveMixPoints } from "@spectado/shared-types";
import { apiClient, apiUrl, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { Modal } from "./Modal";
import { CategoryPicker } from "./CategoryPicker";
import { WaveformEditor } from "./WaveformEditor";

const DEFAULT_MIX_DURATIONS_MS = { defaultMixInDurationMs: 5000, defaultMixOutDurationMs: 5000 };

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export function SongEditModal({ song, onClose }: { song: SongDTO; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist);
  const [album, setAlbum] = useState(song.album ?? "");
  const [tags, setTags] = useState(song.tags.join(", "));
  const [categoryIds, setCategoryIds] = useState(song.categories.map((c) => c.id));
  const [isActive, setIsActive] = useState(song.isActive);
  const [newAudioFile, setNewAudioFile] = useState<File | null>(null);
  const [newCoverArt, setNewCoverArt] = useState<File | null>(null);
  const [removeCoverArt, setRemoveCoverArt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchResults, setSearchResults] = useState<MetadataSearchResultDTO[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // null means "use the station default" -- see resolveMixPoints below.
  const [mixInPointMs, setMixInPointMs] = useState(song.mixInPointMs);
  const [mixInDurationMs, setMixInDurationMs] = useState(song.mixInDurationMs);
  const [mixOutPointMs, setMixOutPointMs] = useState(song.mixOutPointMs);
  const [mixOutDurationMs, setMixOutDurationMs] = useState(song.mixOutDurationMs);

  const stationSettingsQuery = useQuery({
    queryKey: ["settings", "station"],
    queryFn: () => apiClient.get<StationSettingsDTO>("/settings/station"),
  });
  const mixDefaults = stationSettingsQuery.data ?? DEFAULT_MIX_DURATIONS_MS;
  const resolvedMix = resolveMixPoints(
    { durationMs: song.durationMs, mixInPointMs, mixInDurationMs, mixOutPointMs, mixOutDurationMs },
    mixDefaults,
  );

  const updateMutation = useMutation({
    mutationFn: (formData: FormData) => apiClient.patch(`/library/songs/${song.id}`, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library", "songs"] });
      showToast("success", `Saved changes to "${title.trim() || song.title}"`);
      onClose();
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : "Update failed";
      setError(message);
      showToast("error", `Couldn't update "${song.title}": ${message}`);
    },
  });

  const applyMetadataMutation = useMutation({
    mutationFn: (result: MetadataSearchResultDTO) =>
      apiClient.post<SongDTO>(`/library/songs/${song.id}/apply-metadata`, result),
    onSuccess: (updated) => {
      setTitle(updated.title);
      setArtist(updated.artist);
      setAlbum(updated.album ?? "");
      setSearchResults(null);
      queryClient.invalidateQueries({ queryKey: ["library", "songs"] });
      showToast("success", `Applied metadata for "${updated.title}"`);
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : "Couldn't apply metadata";
      setSearchError(message);
      showToast("error", message);
    },
  });

  async function handleSearch() {
    setSearching(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ title: title || song.title });
      if (artist) params.set("artist", artist);
      const results = await apiClient.get<MetadataSearchResultDTO[]>(
        `/library/songs/metadata-search?${params.toString()}`,
      );
      setSearchResults(results);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Search failed";
      setSearchError(message);
      showToast("error", message);
    } finally {
      setSearching(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("title", title.trim());
    formData.set("artist", artist.trim());
    formData.set("album", album.trim());
    formData.set("categoryIds", JSON.stringify(categoryIds));
    formData.set(
      "tags",
      JSON.stringify(
        tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    );
    formData.set("isActive", String(isActive));
    formData.set("mixInPointMs", mixInPointMs === null ? "null" : String(mixInPointMs));
    formData.set("mixInDurationMs", mixInDurationMs === null ? "null" : String(mixInDurationMs));
    formData.set("mixOutPointMs", mixOutPointMs === null ? "null" : String(mixOutPointMs));
    formData.set("mixOutDurationMs", mixOutDurationMs === null ? "null" : String(mixOutDurationMs));
    if (newAudioFile) formData.set("file", newAudioFile);
    if (newCoverArt) {
      formData.set("coverArt", newCoverArt);
    } else if (removeCoverArt) {
      formData.set("removeCoverArt", "true");
    }
    updateMutation.mutate(formData);
  }

  return (
    <Modal title={`Edit "${song.title}"`} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <label>
            <span className={labelClass}>Title</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </label>
          <label>
            <span className={labelClass}>Artist</span>
            <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} className={inputClass} />
          </label>
        </div>

        <label>
          <span className={labelClass}>Album</span>
          <input type="text" value={album} onChange={(e) => setAlbum(e.target.value)} className={inputClass} />
        </label>

        <div className="rounded-md border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Search metadata online (MusicBrainz)</span>
            <button
              type="button"
              onClick={handleSearch}
              disabled={searching}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
          {searchError && <p className="mt-2 text-xs text-red-600">{searchError}</p>}
          {searchResults && (
            <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
              {searchResults.length === 0 && <li className="text-xs text-slate-400">No matches found.</li>}
              {searchResults.map((result) => (
                <li
                  key={result.externalId}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    {result.coverArtUrl && (
                      <img src={result.coverArtUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                    )}
                    <span className="truncate">
                      <span className="font-medium text-slate-800">{result.title}</span>
                      {" — "}
                      <span className="text-slate-500">
                        {result.artist ?? "Unknown artist"}
                        {result.album ? `, ${result.album}` : ""}
                        {result.year ? ` (${result.year})` : ""}
                      </span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyMetadataMutation.mutate(result)}
                    disabled={applyMetadataMutation.isPending}
                    className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Apply
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label>
          <span className={labelClass}>Tags (comma-separated)</span>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} className={inputClass} />
        </label>

        <div>
          <span className={labelClass}>Categories</span>
          <CategoryPicker selectedIds={categoryIds} onChange={setCategoryIds} />
        </div>

        <div className="rounded-md border border-slate-200 p-3">
          <span className="text-sm font-medium text-slate-700">Crossfade mix points</span>
          <p className="mb-3 mt-1 text-xs text-slate-500">
            Where this song fades in/out when transitioning to/from another song. Leave a pair unset to use the
            station's default (currently {(mixDefaults.defaultMixInDurationMs / 1000).toFixed(1)}s in /{" "}
            {(mixDefaults.defaultMixOutDurationMs / 1000).toFixed(1)}s out).
          </p>

          <WaveformEditor
            songId={song.id}
            durationMs={song.durationMs}
            mixInPointMs={resolvedMix.mixInPointMs}
            mixInDurationMs={resolvedMix.mixInDurationMs}
            mixOutPointMs={resolvedMix.mixOutPointMs}
            mixOutDurationMs={resolvedMix.mixOutDurationMs}
            onMixInChange={(pointMs, durationMs) => {
              setMixInPointMs(Math.round(pointMs));
              setMixInDurationMs(Math.round(durationMs));
            }}
            onMixOutChange={(pointMs, durationMs) => {
              setMixOutPointMs(Math.round(pointMs));
              setMixOutDurationMs(Math.round(durationMs));
            }}
          />

          <div className="mt-3 grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2 rounded-md bg-blue-50/60 p-2">
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className="mb-1 block text-xs font-medium text-slate-600">Mix-in point (s)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={(resolvedMix.mixInPointMs / 1000).toFixed(1)}
                    onChange={(e) => setMixInPointMs(Math.round(Number(e.target.value) * 1000))}
                    className={inputClass}
                  />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-medium text-slate-600">Mix-in duration (s)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={(resolvedMix.mixInDurationMs / 1000).toFixed(1)}
                    onChange={(e) => setMixInDurationMs(Math.round(Number(e.target.value) * 1000))}
                    className={inputClass}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMixInPointMs(null);
                  setMixInDurationMs(null);
                }}
                disabled={mixInPointMs === null && mixInDurationMs === null}
                className="self-start text-xs font-medium text-blue-700 underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
              >
                Reset mix-in to default
              </button>
            </div>

            <div className="flex flex-col gap-2 rounded-md bg-orange-50/60 p-2">
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className="mb-1 block text-xs font-medium text-slate-600">Mix-out point (s)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={(resolvedMix.mixOutPointMs / 1000).toFixed(1)}
                    onChange={(e) => setMixOutPointMs(Math.round(Number(e.target.value) * 1000))}
                    className={inputClass}
                  />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-medium text-slate-600">Mix-out duration (s)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={(resolvedMix.mixOutDurationMs / 1000).toFixed(1)}
                    onChange={(e) => setMixOutDurationMs(Math.round(Number(e.target.value) * 1000))}
                    className={inputClass}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMixOutPointMs(null);
                  setMixOutDurationMs(null);
                }}
                disabled={mixOutPointMs === null && mixOutDurationMs === null}
                className="self-start text-xs font-medium text-orange-700 underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
              >
                Reset mix-out to default
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label>
            <span className={labelClass}>Replace audio file (optional)</span>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setNewAudioFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600"
            />
          </label>
          <label>
            <span className={labelClass}>Replace cover art (optional)</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                setNewCoverArt(e.target.files?.[0] ?? null);
                if (e.target.files?.[0]) setRemoveCoverArt(false);
              }}
              className="block w-full text-sm text-slate-600"
            />
          </label>
        </div>

        {song.coverArtUrl && !newCoverArt && (
          <div className="flex items-center gap-3">
            <img src={apiUrl(song.coverArtUrl)} alt="" className="h-12 w-12 rounded object-cover" />
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={removeCoverArt}
                onChange={(e) => setRemoveCoverArt(e.target.checked)}
              />
              Remove current cover art
            </label>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active (eligible for playback)
        </label>

        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
