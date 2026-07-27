import { type FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AdDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { Modal } from "./Modal";
import { DateTimePicker } from "./DateTimePicker";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "../lib/format";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export function AdEditModal({ ad, onClose }: { ad: AdDTO; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(ad.title);
  const [activeFrom, setActiveFrom] = useState(toDatetimeLocalValue(ad.activeFrom));
  const [activeUntil, setActiveUntil] = useState(toDatetimeLocalValue(ad.activeUntil));
  const [isActive, setIsActive] = useState(ad.isActive);
  const [newAudioFile, setNewAudioFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: (formData: FormData) => apiClient.patch(`/library/ads/${ad.id}`, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library", "ads"] });
      showToast("success", `Saved changes to "${title.trim() || ad.title}"`);
      onClose();
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : "Update failed";
      setError(message);
      showToast("error", `Couldn't update "${ad.title}": ${message}`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("title", title.trim());
    formData.set("activeFrom", fromDatetimeLocalValue(activeFrom));
    formData.set("activeUntil", fromDatetimeLocalValue(activeUntil));
    formData.set("isActive", String(isActive));
    if (newAudioFile) formData.set("file", newAudioFile);
    updateMutation.mutate(formData);
  }

  return (
    <Modal title={`Edit "${ad.title}"`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label>
          <span className={labelClass}>Title</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label>
            <span className={labelClass}>Active from</span>
            <DateTimePicker value={activeFrom} onChange={setActiveFrom} />
          </label>
          <label>
            <span className={labelClass}>Active until</span>
            <DateTimePicker value={activeUntil} onChange={setActiveUntil} />
          </label>
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
          Active (eligible for playback within the window above)
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
