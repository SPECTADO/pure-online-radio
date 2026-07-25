import { create } from "zustand";

export type ToastType = "success" | "error";

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastState {
  toasts: ToastItem[];
  dismiss: (id: string) => void;
}

const AUTO_DISMISS_MS: Record<ToastType, number> = {
  success: 4000,
  error: 8000, // errors stay longer -- more likely to need actually reading
};

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/**
 * Plain function, not a hook -- callers that aren't React components
 * (mutation `onError`/`onSuccess` handlers, the upload queue store) need to
 * fire a toast too, and hooks can't be called from those.
 */
export function showToast(type: ToastType, message: string): void {
  const id = crypto.randomUUID();
  useToastStore.setState((state) => ({ toasts: [...state.toasts, { id, type, message }] }));
  setTimeout(() => useToastStore.getState().dismiss(id), AUTO_DISMISS_MS[type]);
}
