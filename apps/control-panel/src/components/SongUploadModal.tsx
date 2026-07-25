import { type FormEvent, useState } from "react";
import { useUploadQueueStore } from "../lib/uploadQueueStore";
import { Modal } from "./Modal";
import { CategoryPicker } from "./CategoryPicker";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export function SongUploadModal({ onClose }: { onClose: () => void }) {
  const enqueue = useUploadQueueStore((s) => s.enqueue);
  const [files, setFiles] = useState<File[]>([]);
  const [coverArt, setCoverArt] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [tags, setTags] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isBatch = files.length > 1;

  function sharedFields(formData: FormData) {
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
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (files.length === 0) {
      setError("Choose at least one audio file to upload");
      return;
    }
    setError(null);

    if (isBatch) {
      files.forEach((file) => {
        const formData = new FormData();
        formData.set("file", file);
        sharedFields(formData);
        enqueue({
          path: "/library/songs",
          formData,
          filename: file.name,
          label: "song",
          invalidateKey: ["library", "songs"],
        });
      });
    } else {
      const file = files[0]!;
      const formData = new FormData();
      formData.set("file", file);
      if (coverArt) formData.set("coverArt", coverArt);
      if (title.trim()) formData.set("title", title.trim());
      if (artist.trim()) formData.set("artist", artist.trim());
      if (album.trim()) formData.set("album", album.trim());
      sharedFields(formData);
      enqueue({
        path: "/library/songs",
        formData,
        filename: file.name,
        label: "song",
        invalidateKey: ["library", "songs"],
      });
    }

    onClose();
  }

  return (
    <Modal title="Upload songs" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label>
          <span className={labelClass}>Audio file(s)</span>
          <input
            type="file"
            accept="audio/*"
            multiple
            required
            onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
            className="block w-full text-sm text-slate-600"
          />
          <p className="mt-1 text-xs text-slate-400">
            Select multiple files to batch-upload -- each song's title/artist/album/cover art is still
            read from its own ID3 tags, individually. Uploads run in the background (see the tray in the
            bottom-right corner) -- you can close this dialog right away.
          </p>
        </label>

        {!isBatch && (
          <>
            <label>
              <span className={labelClass}>Cover art (optional)</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setCoverArt(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600"
              />
              <p className="mt-1 text-xs text-slate-400">
                If left blank, cover art embedded in the file's ID3 tags is used automatically.
              </p>
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label>
                <span className={labelClass}>Title</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Auto-detected from ID3 tags"
                  className={inputClass}
                />
              </label>
              <label>
                <span className={labelClass}>Artist</span>
                <input
                  type="text"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="Auto-detected from ID3 tags"
                  className={inputClass}
                />
              </label>
            </div>

            <label>
              <span className={labelClass}>Album</span>
              <input
                type="text"
                value={album}
                onChange={(e) => setAlbum(e.target.value)}
                placeholder="Auto-detected from ID3 tags"
                className={inputClass}
              />
            </label>
          </>
        )}

        <label>
          <span className={labelClass}>
            Tags (comma-separated){isBatch ? " -- applied to every file in this batch" : ""}
          </span>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} className={inputClass} />
        </label>

        <div>
          <span className={labelClass}>
            Categories{isBatch ? " -- applied to every file in this batch" : ""}
          </span>
          <CategoryPicker selectedIds={categoryIds} onChange={setCategoryIds} />
        </div>

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
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {isBatch ? `Queue ${files.length} songs` : "Upload"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
