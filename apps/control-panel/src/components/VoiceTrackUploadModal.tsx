import { type FormEvent, useState } from "react";
import { useUploadQueueStore } from "../lib/uploadQueueStore";
import { Modal } from "./Modal";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

const VOICE_TRACKS_KEY = ["library", "voice-tracks"];

export function VoiceTrackUploadModal({ onClose }: { onClose: () => void }) {
  const enqueue = useUploadQueueStore((s) => s.enqueue);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose an audio file to upload");
      return;
    }
    setError(null);

    const formData = new FormData();
    formData.set("file", file);
    if (title.trim()) formData.set("title", title.trim());
    enqueue({
      path: "/library/voice-tracks",
      formData,
      filename: file.name,
      label: "voice track",
      invalidateKey: VOICE_TRACKS_KEY,
    });

    onClose();
  }

  return (
    <Modal title="Upload voice track" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label>
          <span className={labelClass}>Audio file</span>
          <input
            type="file"
            accept="audio/*"
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600"
          />
          <p className="mt-1 text-xs text-slate-400">Uploads run in the background -- you can close this dialog right away.</p>
        </label>

        <label>
          <span className={labelClass}>Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Auto-detected from ID3 tags or filename"
            className={inputClass}
          />
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
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Upload
          </button>
        </div>
      </form>
    </Modal>
  );
}
