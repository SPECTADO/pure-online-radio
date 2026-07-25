import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MediaKind } from "@spectado/shared-types";
import { apiClient, ApiError } from "./apiClient";
import { showToast } from "./toastStore";

/** Shared "add to queue" mutation used by the Queue page's search results and
 * every library page's row action -- keeps the invalidate/toast logic in one place. */
export function useAddToQueue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { mediaKind: MediaKind; mediaId: string; title: string; playNext?: boolean }) =>
      apiClient.post("/queue/items", { mediaKind: params.mediaKind, mediaId: params.mediaId, playNext: params.playNext }),
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      showToast("success", params.playNext ? `"${params.title}" will play next` : `Added "${params.title}" to the queue`);
    },
    onError: (err, params) => {
      showToast(
        "error",
        `Couldn't add "${params.title}" to the queue: ${err instanceof ApiError ? err.message : "request failed"}`,
      );
    },
  });
}
