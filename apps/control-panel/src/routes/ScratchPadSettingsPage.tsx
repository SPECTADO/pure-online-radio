import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JingleDTO, ScratchPadDTO, ScratchPadSlotDTO } from "@spectado/shared-types";
import { SCRATCH_PAD_SLOT_COUNT } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";

const selectClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

function emptySlots(): ScratchPadSlotDTO[] {
  return Array.from({ length: SCRATCH_PAD_SLOT_COUNT }, (_, position) => ({ position, jingleId: null }));
}

export function ScratchPadSettingsPage() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["settings", "scratch-pad"],
    queryFn: () => apiClient.get<ScratchPadDTO>("/settings/scratch-pad"),
  });
  const jinglesQuery = useQuery({
    queryKey: ["library", "jingles"],
    queryFn: () => apiClient.get<JingleDTO[]>("/library/jingles"),
  });

  const [slots, setSlots] = useState<ScratchPadSlotDTO[]>(emptySlots());

  useEffect(() => {
    if (!query.data) return;
    setSlots([...query.data.slots].sort((a, b) => a.position - b.position));
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: () => apiClient.put<ScratchPadDTO>("/settings/scratch-pad", { slots }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "scratch-pad"] });
      showToast("success", "Scratch pad saved");
    },
    onError: (err) => {
      showToast("error", `Couldn't save scratch pad: ${err instanceof ApiError ? err.message : "request failed"}`);
    },
  });

  function setSlotJingle(position: number, jingleId: string | null) {
    setSlots((current) => current.map((slot) => (slot.position === position ? { ...slot, jingleId } : slot)));
  }

  const activeJingles = (jinglesQuery.data ?? []).filter((jingle) => jingle.isActive);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Scratch Pad Settings</h1>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {query.isError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load scratch pad settings: {(query.error as Error).message}
        </div>
      )}

      {query.data && (
        <div className="max-w-2xl rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Dashboard buttons
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Assign a jingle to each of the 10 Dashboard scratch pad buttons. Leave a slot empty to disable it.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {slots.map((slot) => (
              <label key={slot.position} className="flex items-center gap-3">
                <span className="w-6 shrink-0 text-sm font-medium text-slate-400">{slot.position + 1}</span>
                <select
                  value={slot.jingleId ?? ""}
                  onChange={(e) => setSlotJingle(slot.position, e.target.value === "" ? null : e.target.value)}
                  className={selectClass}
                >
                  <option value="">— Empty —</option>
                  {activeJingles.map((jingle) => (
                    <option key={jingle.id} value={jingle.id}>
                      {jingle.title}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saveMutation.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
