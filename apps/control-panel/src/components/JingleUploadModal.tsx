import { type FormEvent, useState } from "react";
import type { JingleType } from "@spectado/shared-types";
import { useUploadQueueStore } from "../lib/uploadQueueStore";
import { Modal } from "./Modal";
import { CategoryPicker } from "./CategoryPicker";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

const JINGLE_TYPES: JingleType[] = ["STATION_ID", "SWEEPER", "SFX", "PROMO", "ADVERT", "OTHER"];

export function JingleUploadModal({ onClose }: { onClose: () => void }) {
  const enqueue = useUploadQueueStore((s) => s.enqueue);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<JingleType>("OTHER");
  const [tags, setTags] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isBatch = files.length > 1;

  function sharedFields(formData: FormData) {
    formData.set("type", type);
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
          path: "/library/jingles",
          formData,
          filename: file.name,
          label: "jingle",
          invalidateKey: ["library", "jingles"],
        });
      });
    } else {
      const file = files[0]!;
      const formData = new FormData();
      formData.set("file", file);
      if (title.trim()) formData.set("title", title.trim());
      sharedFields(formData);
      enqueue({
        path: "/library/jingles",
        formData,
        filename: file.name,
        label: "jingle",
        invalidateKey: ["library", "jingles"],
      });
    }

    onClose();
  }

  return (
    <Modal title="Upload jingles" onClose={onClose} wide>
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
            Select multiple files to batch-upload -- each jingle's title is still read from its own ID3
            tags, individually. Uploads run in the background -- you can close this dialog right away.
          </p>
        </label>

        <div className="grid grid-cols-2 gap-4">
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
          <label className={isBatch ? "col-span-2" : undefined}>
            <span className={labelClass}>Type{isBatch ? " -- applied to every file in this batch" : ""}</span>
            <select value={type} onChange={(e) => setType(e.target.value as JingleType)} className={inputClass}>
              {JINGLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

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
            {isBatch ? `Queue ${files.length} jingles` : "Upload"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
