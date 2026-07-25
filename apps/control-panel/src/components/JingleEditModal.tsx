import { type FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { JingleDTO, JingleType } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { Modal } from "./Modal";
import { CategoryPicker } from "./CategoryPicker";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

const JINGLE_TYPES: JingleType[] = ["STATION_ID", "SWEEPER", "SFX", "PROMO", "ADVERT", "OTHER"];

export function JingleEditModal({ jingle, onClose }: { jingle: JingleDTO; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(jingle.title);
  const [type, setType] = useState<JingleType>(jingle.type);
  const [tags, setTags] = useState(jingle.tags.join(", "));
  const [categoryIds, setCategoryIds] = useState(jingle.categories.map((c) => c.id));
  const [isActive, setIsActive] = useState(jingle.isActive);
  const [newAudioFile, setNewAudioFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: (formData: FormData) => apiClient.patch(`/library/jingles/${jingle.id}`, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library", "jingles"] });
      showToast("success", `Saved changes to "${title.trim() || jingle.title}"`);
      onClose();
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : "Update failed";
      setError(message);
      showToast("error", `Couldn't update "${jingle.title}": ${message}`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("title", title.trim());
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
    formData.set("isActive", String(isActive));
    if (newAudioFile) formData.set("file", newAudioFile);
    updateMutation.mutate(formData);
  }

  return (
    <Modal title={`Edit "${jingle.title}"`} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <label>
            <span className={labelClass}>Title</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </label>
          <label>
            <span className={labelClass}>Type</span>
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
          <span className={labelClass}>Tags (comma-separated)</span>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} className={inputClass} />
        </label>

        <div>
          <span className={labelClass}>Categories</span>
          <CategoryPicker selectedIds={categoryIds} onChange={setCategoryIds} />
        </div>

        <label>
          <span className={labelClass}>Replace audio file (optional)</span>
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setNewAudioFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600"
          />
        </label>

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
