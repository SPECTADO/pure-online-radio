import { create } from "zustand";
import type { QueryKey } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { showToast } from "./toastStore";
import { uploadWithProgress } from "./uploadXhr";

export type UploadStatus = "queued" | "uploading" | "done" | "error";

export interface UploadQueueItem {
  id: string;
  filename: string;
  /** e.g. "song", "jingle", "ad" -- used in toast wording. */
  label: string;
  status: UploadStatus;
  progress: number;
  error?: string;
  path: string;
  formData: FormData;
  invalidateKey: QueryKey;
}

interface EnqueueInput {
  path: string;
  formData: FormData;
  filename: string;
  label: string;
  invalidateKey: QueryKey;
}

interface UploadQueueState {
  items: UploadQueueItem[];
  enqueue: (input: EnqueueInput) => void;
  dismiss: (id: string) => void;
  clearFinished: () => void;
}

/** Caps concurrent uploads across the WHOLE app (not per-modal) -- multiple
 * large audio files racing each other for bandwidth/server resources isn't
 * worth it, and this is a single shared queue precisely so a song batch and
 * a jingle batch started separately still share one limit. */
const MAX_CONCURRENT = 3;

/**
 * Deliberately outlives any modal: uploads are enqueued here and the modal
 * that started them can close immediately -- progress/success/failure is
 * tracked globally (UploadQueueTray) and reported via toasts, not tied to
 * whichever component happened to trigger the upload.
 */
export const useUploadQueueStore = create<UploadQueueState>((set, get) => {
  function updateItem(id: string, patch: Partial<UploadQueueItem>) {
    set((state) => ({ items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
  }

  function runNext() {
    const { items } = get();
    const uploadingCount = items.filter((i) => i.status === "uploading").length;
    const slotsFree = MAX_CONCURRENT - uploadingCount;
    if (slotsFree <= 0) return;

    items
      .filter((i) => i.status === "queued")
      .slice(0, slotsFree)
      .forEach(startUpload);
  }

  function startUpload(item: UploadQueueItem) {
    updateItem(item.id, { status: "uploading" });

    uploadWithProgress(item.path, item.formData, (progress) => updateItem(item.id, { progress }))
      .then(() => {
        updateItem(item.id, { status: "done", progress: 100 });
        queryClient.invalidateQueries({ queryKey: item.invalidateKey });
        showToast("success", `Uploaded ${item.label} "${item.filename}"`);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Upload failed";
        updateItem(item.id, { status: "error", error: message });
        showToast("error", `Failed to upload ${item.label} "${item.filename}": ${message}`);
      })
      .finally(runNext);
  }

  return {
    items: [],

    enqueue: (input) => {
      const id = crypto.randomUUID();
      set((state) => ({
        items: [...state.items, { ...input, id, status: "queued", progress: 0 }],
      }));
      runNext();
    },

    dismiss: (id) => set((state) => ({ items: state.items.filter((i) => i.id !== id) })),

    clearFinished: () =>
      set((state) => ({
        items: state.items.filter((i) => i.status === "queued" || i.status === "uploading"),
      })),
  };
});
