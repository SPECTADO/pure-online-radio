import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JingleDTO, ScratchPadDTO, ScratchPadSlotDTO } from "@spectado/shared-types";
import { SCRATCH_PAD_SLOT_COUNT } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { Modal } from "../components/Modal";

function emptySlots(): ScratchPadSlotDTO[] {
  return Array.from({ length: SCRATCH_PAD_SLOT_COUNT }, (_, position) => ({ position, jingleId: null }));
}

interface JinglePickerModalProps {
  position: number;
  jingles: JingleDTO[];
  selectedJingleId: string | null;
  onPick: (jingleId: string | null) => void;
  onClose: () => void;
}

function JinglePickerModal({ position, jingles, selectedJingleId, onPick, onClose }: JinglePickerModalProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return jingles;
    return jingles.filter((jingle) => jingle.title.toLowerCase().includes(term));
  }, [jingles, search]);

  return (
    <Modal title={`Assign button ${position + 1}`} onClose={onClose}>
      <input
        type="text"
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search jingles…"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />

      <div className="mt-3 max-h-80 overflow-y-auto rounded-md border border-slate-200">
        <button
          type="button"
          onClick={() => onPick(null)}
          className={`block w-full px-3 py-2 text-left text-sm ${
            selectedJingleId === null ? "bg-slate-900 text-white" : "text-slate-400 hover:bg-slate-50"
          }`}
        >
          — Empty —
        </button>
        {filtered.length === 0 && <p className="px-3 py-4 text-center text-sm text-slate-400">No jingles match.</p>}
        {filtered.map((jingle) => (
          <button
            key={jingle.id}
            type="button"
            onClick={() => onPick(jingle.id)}
            className={`block w-full border-t border-slate-100 px-3 py-2 text-left text-sm ${
              selectedJingleId === jingle.id ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            {jingle.title}
          </button>
        ))}
      </div>
    </Modal>
  );
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
  const [pickerPosition, setPickerPosition] = useState<number | null>(null);

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
    setPickerPosition(null);
  }

  const activeJingles = (jinglesQuery.data ?? []).filter((jingle) => jingle.isActive);
  const jingleById = useMemo(() => new Map(activeJingles.map((jingle) => [jingle.id, jingle])), [activeJingles]);
  const pickerSlot = pickerPosition !== null ? slots.find((slot) => slot.position === pickerPosition) : undefined;

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
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Dashboard buttons
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Assign a jingle to each of the {SCRATCH_PAD_SLOT_COUNT} Dashboard scratch pad buttons -- click one to
            change it. Leave a slot empty to disable it.
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {slots.map((slot) => {
              const jingle = slot.jingleId ? jingleById.get(slot.jingleId) : undefined;
              const isMissing = !!slot.jingleId && !jingle;

              return (
                <button
                  key={slot.position}
                  type="button"
                  onClick={() => setPickerPosition(slot.position)}
                  title={jingle?.title}
                  className={`relative flex h-20 flex-col items-center justify-center overflow-hidden rounded-lg border px-2 py-2 text-center text-xs font-medium transition-colors ${
                    jingle
                      ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      : "border-dashed border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100"
                  }`}
                >
                  <span className="absolute left-1.5 top-1.5 text-[10px] font-semibold text-slate-400">
                    {slot.position + 1}
                  </span>
                  <span className="line-clamp-2 wrap-break-word">
                    {jingle ? jingle.title : isMissing ? "Missing" : "Empty"}
                  </span>
                </button>
              );
            })}
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

      {pickerPosition !== null && (
        <JinglePickerModal
          position={pickerPosition}
          jingles={activeJingles}
          selectedJingleId={pickerSlot?.jingleId ?? null}
          onPick={(jingleId) => setSlotJingle(pickerPosition, jingleId)}
          onClose={() => setPickerPosition(null)}
        />
      )}
    </div>
  );
}
