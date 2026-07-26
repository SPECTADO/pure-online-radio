import { type FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ScheduleRuleDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { DEFAULT_TRIGGER_FORM_STATE, triggerFormStateToPayload, triggerToFormState } from "../lib/scheduleTrigger";
import { Modal } from "./Modal";
import { ScheduleTriggerFields } from "./ScheduleTriggerFields";
import { ScheduleItemPicker, type PickedScheduleItem } from "./ScheduleItemPicker";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

const SCHEDULE_KEY = ["schedule"];

export function ScheduleRuleModal({ rule, onClose }: { rule?: ScheduleRuleDTO; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(rule?.name ?? "");
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);
  const [trigger, setTrigger] = useState(rule ? triggerToFormState(rule) : DEFAULT_TRIGGER_FORM_STATE);
  const [items, setItems] = useState<PickedScheduleItem[]>(
    rule?.items.map((item) => ({
      key: crypto.randomUUID(),
      mediaKind: item.mediaKind,
      mediaId: item.mediaId,
      title: item.title,
      artist: item.artist,
      durationMs: item.durationMs,
    })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: unknown) =>
      rule ? apiClient.patch(`/schedule/${rule.id}`, payload) : apiClient.post("/schedule", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SCHEDULE_KEY });
      showToast("success", rule ? `Saved changes to "${name.trim()}"` : `Created schedule rule "${name.trim()}"`);
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

    if (items.length === 0) {
      setError("Add at least one song, jingle, or ad to this rule.");
      return;
    }

    mutation.mutate({
      name: name.trim(),
      isActive,
      ...triggerFormStateToPayload(trigger),
      items: items.map((item) => ({ mediaKind: item.mediaKind, mediaId: item.mediaId })),
    });
  }

  return (
    <Modal title={rule ? `Edit "${rule.name}"` : "New schedule rule"} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label>
          <span className={labelClass}>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            required
          />
        </label>

        <ScheduleTriggerFields value={trigger} onChange={setTrigger} />

        <div>
          <span className={labelClass}>Items (played in this order)</span>
          <ScheduleItemPicker items={items} onChange={setItems} />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
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
