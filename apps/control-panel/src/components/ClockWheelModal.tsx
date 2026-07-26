import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CategoryDTO, ClockWheelDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { Modal } from "./Modal";
import { ClockWheelSlotEditor, type EditableSlot } from "./ClockWheelSlotEditor";
import { ClockWheelStepPicker, type EditableStep } from "./ClockWheelStepPicker";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

const CLOCK_WHEELS_KEY = ["clock-wheels"];

export function ClockWheelModal({ wheel, onClose }: { wheel?: ClockWheelDTO; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isDefault = wheel?.isDefault ?? false;

  const [name, setName] = useState(wheel?.name ?? "");
  const [isActive, setIsActive] = useState(wheel?.isActive ?? true);
  const [slots, setSlots] = useState<EditableSlot[]>(
    wheel?.slots.map((slot) => ({
      key: crypto.randomUUID(),
      weekdays: slot.weekdays,
      startTime: slot.startTime,
      endTime: slot.endTime,
    })) ?? [],
  );
  const [steps, setSteps] = useState<EditableStep[]>(
    wheel?.steps
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((step) => ({
        key: crypto.randomUUID(),
        mediaKind: step.mediaKind,
        selectionStrategy: step.selectionStrategy,
        categoryId: step.categoryId,
        tag: step.tag ?? "",
      })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ["library", "categories"],
    queryFn: () => apiClient.get<CategoryDTO[]>("/library/categories"),
  });

  const mutation = useMutation({
    mutationFn: (payload: unknown) =>
      wheel ? apiClient.patch(`/clock-wheels/${wheel.id}`, payload) : apiClient.post("/clock-wheels", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLOCK_WHEELS_KEY });
      showToast("success", wheel ? `Saved changes to "${name.trim()}"` : `Created clock wheel "${name.trim()}"`);
      onClose();
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : "Request failed";
      setError(message);
      showToast("error", message);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (steps.length === 0) {
      setError("Add at least one rotation step.");
      return;
    }

    mutation.mutate({
      name: name.trim(),
      isActive,
      slots: slots.map((slot) => ({ weekdays: slot.weekdays, startTime: slot.startTime, endTime: slot.endTime })),
      steps: steps.map((step) => ({
        mediaKind: step.mediaKind,
        selectionStrategy: step.selectionStrategy,
        categoryId: step.categoryId,
        tag: step.tag.trim() || null,
      })),
    });
  }

  return (
    <Modal title={wheel ? `Edit "${wheel.name}"` : "New clock wheel"} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label>
          <span className={labelClass}>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
        </label>

        {isDefault ? (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
            The default wheel fills any time no other active clock wheel matches -- it has no day/time windows of
            its own and is always on.
          </p>
        ) : (
          <div>
            <span className={labelClass}>Active on</span>
            <ClockWheelSlotEditor slots={slots} onChange={setSlots} />
          </div>
        )}

        <div>
          <span className={labelClass}>Rotation steps (played in order, then repeats)</span>
          <ClockWheelStepPicker steps={steps} categories={categoriesQuery.data ?? []} onChange={setSteps} />
        </div>

        {!isDefault && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        )}

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
            disabled={mutation.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
