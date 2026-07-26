import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueueEntryDTO, ScheduleRuleDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { describeTrigger } from "../lib/scheduleTrigger";
import { formatDateTime } from "../lib/format";
import { useTimeFormat } from "../lib/useTimeFormat";
import { ComingSoon } from "../components/ComingSoon";
import { Modal } from "../components/Modal";
import { ScheduleRuleModal } from "../components/ScheduleRuleModal";
import { rowActionButton, rowActionButtonDanger } from "../lib/buttonStyles";

const SCHEDULE_KEY = ["schedule"];
const UPCOMING_KEY = ["schedule", "upcoming"];

export function SchedulePage() {
  const timeFormat = useTimeFormat();
  const queryClient = useQueryClient();
  const [modalMode, setModalMode] = useState<"none" | "create" | ScheduleRuleDTO>("none");
  const [pendingDelete, setPendingDelete] = useState<ScheduleRuleDTO | null>(null);

  const rulesQuery = useQuery({
    queryKey: SCHEDULE_KEY,
    queryFn: () => apiClient.get<ScheduleRuleDTO[]>("/schedule"),
    retry: false,
  });

  const upcomingQuery = useQuery({
    queryKey: UPCOMING_KEY,
    queryFn: () => apiClient.get<QueueEntryDTO[]>("/schedule/upcoming"),
    retry: false,
    refetchInterval: 15_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (rule: ScheduleRuleDTO) => apiClient.delete(`/schedule/${rule.id}`),
    onSuccess: (_data, rule) => {
      queryClient.invalidateQueries({ queryKey: SCHEDULE_KEY });
      showToast("success", `Deleted schedule rule "${rule.name}"`);
      setPendingDelete(null);
    },
    onError: (err, rule) => {
      showToast(
        "error",
        `Couldn't delete "${rule.name}": ${err instanceof ApiError ? err.message : "request failed"}`,
      );
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Schedule</h1>
        <button
          type="button"
          onClick={() => setModalMode("create")}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          New rule
        </button>
      </div>

      {rulesQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {rulesQuery.isError && rulesQuery.error instanceof ApiError && rulesQuery.error.isNotImplemented && (
        <ComingSoon
          title="Schedule"
          detail="Scheduling songs, jingles, and streams for a specific time isn't implemented yet."
        />
      )}

      {rulesQuery.isError && !(rulesQuery.error instanceof ApiError && rulesQuery.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load the schedule: {(rulesQuery.error as Error).message}
        </div>
      )}

      {rulesQuery.data && rulesQuery.data.length === 0 && (
        <ComingSoon
          title="No schedule rules yet"
          detail="Create a rule to schedule songs, jingles, or ads for a specific time, a weekly slot, a repeating interval, or every N songs played."
        />
      )}

      {rulesQuery.data && rulesQuery.data.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Insertion</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Last triggered</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rulesQuery.data.map((rule) => (
                <tr key={rule.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{rule.name}</td>
                  <td className="px-4 py-3 text-slate-600">{describeTrigger(rule, timeFormat)}</td>
                  <td className="px-4 py-3 text-slate-600">{rule.items.length}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {rule.insertionMode === "AT_TIME" ? "At the time" : "As soon as possible"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{rule.isActive ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(rule.lastTriggeredAt, timeFormat)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setModalMode(rule)} className={rowActionButton}>
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(rule)}
                        className={rowActionButtonDanger}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Upcoming</h2>
        {upcomingQuery.data && upcomingQuery.data.length === 0 && (
          <p className="text-sm text-slate-500">Nothing materialized yet -- due items will show up here.</p>
        )}
        {upcomingQuery.data && upcomingQuery.data.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Media</th>
                  <th className="px-4 py-3">Scheduled for</th>
                  <th className="px-4 py-3">From rule</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {upcomingQuery.data.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {entry.title}
                      {entry.artist && <span className="ml-2 font-normal text-slate-500">{entry.artist}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(entry.scheduledFor, timeFormat)}</td>
                    <td className="px-4 py-3 text-slate-600">{entry.scheduleRuleName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalMode !== "none" && (
        <ScheduleRuleModal
          rule={modalMode === "create" ? undefined : modalMode}
          onClose={() => setModalMode("none")}
        />
      )}

      {pendingDelete && (
        <Modal title="Delete schedule rule" onClose={() => setPendingDelete(null)}>
          <p className="text-sm text-slate-600">Delete "{pendingDelete.name}"? This can't be undone.</p>
          {deleteMutation.isError && (
            <p className="mt-2 text-sm text-red-600">
              {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Delete failed"}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => deleteMutation.mutate(pendingDelete)}
              disabled={deleteMutation.isPending}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
