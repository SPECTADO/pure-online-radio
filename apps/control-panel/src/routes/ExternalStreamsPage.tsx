import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExternalStreamDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { describeTrigger } from "../lib/scheduleTrigger";
import { useTimeFormat } from "../lib/useTimeFormat";
import { ComingSoon } from "../components/ComingSoon";
import { Modal } from "../components/Modal";
import { ExternalStreamModal } from "../components/ExternalStreamModal";
import { rowActionButton, rowActionButtonDanger } from "../lib/buttonStyles";

const EXTERNAL_STREAMS_KEY = ["external-streams"];

const END_BEHAVIOR_LABELS: Record<ExternalStreamDTO["endBehavior"], string> = {
  NATURAL: "When it ends",
  AT_TIME: "Forced, at a time",
  AFTER_DURATION: "Forced, after a duration",
};

export function ExternalStreamsPage() {
  const timeFormat = useTimeFormat();
  const queryClient = useQueryClient();
  const [modalMode, setModalMode] = useState<"none" | "create" | ExternalStreamDTO>("none");
  const [pendingCancel, setPendingCancel] = useState<ExternalStreamDTO | null>(null);

  const query = useQuery({
    queryKey: EXTERNAL_STREAMS_KEY,
    queryFn: () => apiClient.get<ExternalStreamDTO[]>("/external-streams"),
    retry: false,
    refetchInterval: 15_000,
  });

  const cancelMutation = useMutation({
    mutationFn: (stream: ExternalStreamDTO) => apiClient.delete(`/external-streams/${stream.id}`),
    onSuccess: (_data, stream) => {
      queryClient.invalidateQueries({ queryKey: EXTERNAL_STREAMS_KEY });
      showToast("success", `Cancelled "${stream.name}"`);
      setPendingCancel(null);
    },
    onError: (err, stream) => {
      showToast(
        "error",
        `Couldn't cancel "${stream.name}": ${err instanceof ApiError ? err.message : "request failed"}`,
      );
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">External Streams</h1>
        <button
          type="button"
          onClick={() => setModalMode("create")}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          New stream
        </button>
      </div>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {query.isError && query.error instanceof ApiError && query.error.isNotImplemented && (
        <ComingSoon
          title="External streams"
          detail="Relaying an external stream (e.g. a live remote broadcast) isn't implemented yet."
        />
      )}

      {query.isError && !(query.error instanceof ApiError && query.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load external streams: {(query.error as Error).message}
        </div>
      )}

      {query.data && query.data.length === 0 && (
        <ComingSoon
          title="No external streams"
          detail="Create one to relay an on-demand or live external stream into the primary broadcast."
        />
      )}

      {query.data && query.data.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">URL</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Stops</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {query.data.map((stream) => (
                <tr key={stream.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{stream.name}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-slate-600">{stream.url}</td>
                  <td className="px-4 py-3 text-slate-600">{describeTrigger(stream, timeFormat)}</td>
                  <td className="px-4 py-3 text-slate-600">{END_BEHAVIOR_LABELS[stream.endBehavior]}</td>
                  <td className="px-4 py-3 text-slate-600">{stream.status}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setModalMode(stream)}
                        disabled={stream.status !== "SCHEDULED" && stream.status !== "STOPPED"}
                        className={rowActionButton}
                      >
                        Edit
                      </button>
                      {stream.status !== "CANCELLED" && (
                        <button
                          type="button"
                          onClick={() => setPendingCancel(stream)}
                          className={rowActionButtonDanger}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalMode !== "none" && (
        <ExternalStreamModal stream={modalMode === "create" ? undefined : modalMode} onClose={() => setModalMode("none")} />
      )}

      {pendingCancel && (
        <Modal title="Cancel external stream" onClose={() => setPendingCancel(null)}>
          <p className="text-sm text-slate-600">
            Cancel "{pendingCancel.name}"?
            {pendingCancel.status === "PLAYING" && " This will stop it immediately."}
          </p>
          {cancelMutation.isError && (
            <p className="mt-2 text-sm text-red-600">
              {cancelMutation.error instanceof Error ? cancelMutation.error.message : "Cancel failed"}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingCancel(null)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => cancelMutation.mutate(pendingCancel)}
              disabled={cancelMutation.isPending}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {cancelMutation.isPending ? "Cancelling…" : "Cancel stream"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
