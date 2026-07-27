import { type FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ExternalStreamDTO, ExternalStreamEndBehavior } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "../lib/format";
import { DEFAULT_TRIGGER_FORM_STATE, triggerFormStateToPayload, triggerToFormState } from "../lib/scheduleTrigger";
import { Modal } from "./Modal";
import { ScheduleTriggerFields } from "./ScheduleTriggerFields";
import { DateTimePicker } from "./DateTimePicker";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

const EXTERNAL_STREAMS_KEY = ["external-streams"];

export function ExternalStreamModal({ stream, onClose }: { stream?: ExternalStreamDTO; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(stream?.name ?? "");
  const [url, setUrl] = useState(stream?.url ?? "");
  const [trigger, setTrigger] = useState(stream ? triggerToFormState(stream) : DEFAULT_TRIGGER_FORM_STATE);
  const [endBehavior, setEndBehavior] = useState<ExternalStreamEndBehavior>(stream?.endBehavior ?? "NATURAL");
  const [endAt, setEndAt] = useState(stream?.endAt ? toDatetimeLocalValue(stream.endAt) : "");
  const [durationMinutes, setDurationMinutes] = useState(
    stream?.durationMs ? String(Math.round(stream.durationMs / 60_000)) : "",
  );
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: unknown) =>
      stream ? apiClient.patch(`/external-streams/${stream.id}`, payload) : apiClient.post("/external-streams", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EXTERNAL_STREAMS_KEY });
      showToast("success", stream ? `Saved changes to "${name.trim()}"` : `Created external stream "${name.trim()}"`);
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

    if (endBehavior === "AT_TIME" && trigger.triggerType !== "ONE_TIME") {
      setError('End behavior "at a time" only makes sense with a one-time trigger.');
      return;
    }

    mutation.mutate({
      name: name.trim(),
      url: url.trim(),
      ...triggerFormStateToPayload(trigger),
      endBehavior,
      endAt: endBehavior === "AT_TIME" && endAt ? fromDatetimeLocalValue(endAt) : null,
      durationMs: endBehavior === "AFTER_DURATION" && durationMinutes ? Number(durationMinutes) * 60_000 : null,
    });
  }

  return (
    <Modal title={stream ? `Edit "${stream.name}"` : "New external stream"} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <label>
            <span className={labelClass}>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
          </label>
          <label>
            <span className={labelClass}>Stream URL</span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className={inputClass}
              placeholder="https://…"
              required
            />
          </label>
        </div>

        <ScheduleTriggerFields value={trigger} onChange={setTrigger} />

        <div className="rounded-md border border-slate-200 p-3">
          <span className={labelClass}>When it stops</span>
          <select
            value={endBehavior}
            onChange={(e) => setEndBehavior(e.target.value as ExternalStreamEndBehavior)}
            className={inputClass}
          >
            <option value="NATURAL">When it ends (on-demand finishes, or the live feed drops)</option>
            <option value="AT_TIME">Forcefully, at a specific time</option>
            <option value="AFTER_DURATION">Forcefully, after a duration</option>
          </select>

          {endBehavior === "AT_TIME" && (
            <label className="mt-3 block">
              <span className={labelClass}>Stop at</span>
              <DateTimePicker value={endAt} onChange={setEndAt} />
            </label>
          )}

          {endBehavior === "AFTER_DURATION" && (
            <label className="mt-3 block">
              <span className={labelClass}>Duration (minutes)</span>
              <input
                type="number"
                min={1}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className={inputClass}
              />
            </label>
          )}
        </div>

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
