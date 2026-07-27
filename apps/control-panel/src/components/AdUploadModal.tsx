import { type FormEvent, useState } from "react";
import { useUploadQueueStore } from "../lib/uploadQueueStore";
import { Modal } from "./Modal";
import { DateTimePicker } from "./DateTimePicker";
import { fromDatetimeLocalValue } from "../lib/format";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export function AdUploadModal({ onClose }: { onClose: () => void }) {
  const enqueue = useUploadQueueStore((s) => s.enqueue);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [activeFrom, setActiveFrom] = useState("");
  const [activeUntil, setActiveUntil] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isBatch = files.length > 1;

  function sharedFields(formData: FormData) {
    formData.set("activeFrom", fromDatetimeLocalValue(activeFrom));
    formData.set("activeUntil", fromDatetimeLocalValue(activeUntil));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (files.length === 0) {
      setError("Choose at least one audio file to upload");
      return;
    }
    if (!activeFrom || !activeUntil) {
      setError("Set both the start and end of the active window");
      return;
    }
    setError(null);

    if (isBatch) {
      files.forEach((file) => {
        const formData = new FormData();
        formData.set("file", file);
        sharedFields(formData);
        enqueue({
          path: "/library/ads",
          formData,
          filename: file.name,
          label: "ad",
          invalidateKey: ["library", "ads"],
        });
      });
    } else {
      const file = files[0]!;
      const formData = new FormData();
      formData.set("file", file);
      if (title.trim()) formData.set("title", title.trim());
      sharedFields(formData);
      enqueue({
        path: "/library/ads",
        formData,
        filename: file.name,
        label: "ad",
        invalidateKey: ["library", "ads"],
      });
    }

    onClose();
  }

  return (
    <Modal title="Upload ads" onClose={onClose}>
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
            Select multiple files to batch-upload -- each ad's title is still read from its own ID3 tags,
            individually. Uploads run in the background -- you can close this dialog right away.
          </p>
        </label>

        {!isBatch && (
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
        )}

        <div className="grid grid-cols-2 gap-4">
          <label>
            <span className={labelClass}>Active from{isBatch ? " -- applied to every file" : ""}</span>
            <DateTimePicker value={activeFrom} onChange={setActiveFrom} />
          </label>
          <label>
            <span className={labelClass}>Active until{isBatch ? " -- applied to every file" : ""}</span>
            <DateTimePicker value={activeUntil} onChange={setActiveUntil} />
          </label>
        </div>
        <p className="-mt-2 text-xs text-slate-400">
          {isBatch ? "These ads" : "This ad"} will never play outside this window, regardless of
          queue/schedule.
        </p>

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
            {isBatch ? `Queue ${files.length} ads` : "Upload"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
