import { create } from "zustand";
import { showToast } from "./toastStore";

interface AudioPreviewState {
  /** id of the library item currently playing, or null if nothing is. Only
   * one preview plays at a time across the whole app -- a single shared
   * <audio> element backs every PreviewButton. */
  playingId: string | null;
  play: (id: string, url: string) => void;
  stop: () => void;
}

let audioEl: HTMLAudioElement | null = null;

export const useAudioPreviewStore = create<AudioPreviewState>((set) => {
  function ensureAudioEl(): HTMLAudioElement {
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.addEventListener("ended", () => set({ playingId: null }));
      audioEl.addEventListener("error", () => {
        set({ playingId: null });
        showToast("error", "Couldn't play preview");
      });
    }
    return audioEl;
  }

  return {
    playingId: null,

    play: (id, url) => {
      const el = ensureAudioEl();
      el.src = url;
      el.currentTime = 0;
      set({ playingId: id });
      el.play().catch(() => {
        set({ playingId: null });
        showToast("error", "Couldn't play preview");
      });
    },

    stop: () => {
      audioEl?.pause();
      set({ playingId: null });
    },
  };
});
