import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClockWheelDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { showToast } from "../lib/toastStore";
import { ComingSoon } from "../components/ComingSoon";
import { Modal } from "../components/Modal";
import { ClockWheelModal } from "../components/ClockWheelModal";
import { rowActionButton, rowActionButtonDanger } from "../lib/buttonStyles";

export function ClockWheelEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const query = useQuery({
    queryKey: ["clock-wheels", id],
    queryFn: () => apiClient.get<ClockWheelDTO>(`/clock-wheels/${id}`),
    enabled: !!id,
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`/clock-wheels/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clock-wheels"] });
      showToast("success", `Deleted "${query.data?.name}"`);
      navigate("/clock-wheels");
    },
    onError: (err) => {
      showToast("error", err instanceof ApiError ? err.message : "Couldn't delete this clock wheel");
      setShowDelete(false);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <Link to="/clock-wheels" className="text-sm text-slate-500 hover:text-slate-700">
            &larr; Clock Wheels
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">
            {query.data?.name ?? "Clock Wheel"}
          </h1>
        </div>
        {query.data && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowEdit(true)} className={rowActionButton}>
              Edit
            </button>
            {!query.data.isDefault && (
              <button type="button" onClick={() => setShowDelete(true)} className={rowActionButtonDanger}>
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {query.isError && query.error instanceof ApiError && query.error.isNotImplemented && (
        <ComingSoon
          title="Clock wheel editor"
          detail="Editing slots and pick-rules for a clock wheel isn't implemented yet."
        />
      )}

      {query.isError && !(query.error instanceof ApiError && query.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load this clock wheel: {(query.error as Error).message}
        </div>
      )}

      {query.data && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Slots
            </h2>
            {query.data.isDefault ? (
              <p className="text-sm text-slate-500">
                The default wheel has no slots of its own -- it fills any time no other active wheel matches.
              </p>
            ) : query.data.slots.length === 0 ? (
              <p className="text-sm text-slate-500">No slots configured.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {query.data.slots.map((slot) => (
                  <li key={slot.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                    <span className="font-medium text-slate-900">
                      {slot.startTime}&ndash;{slot.endTime}
                    </span>{" "}
                    <span className="text-slate-500">
                      on days {slot.weekdays.join(", ") || "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Steps
            </h2>
            {query.data.steps.length === 0 ? (
              <p className="text-sm text-slate-500">No pick-rule steps configured.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {query.data.steps
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((step) => (
                    <li key={step.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                      <span className="font-medium text-slate-900">{step.order + 1}.</span>{" "}
                      {step.mediaKind} &middot; {step.selectionStrategy}
                      {step.tag && <span className="text-slate-500"> &middot; tag: {step.tag}</span>}
                    </li>
                  ))}
              </ol>
            )}
          </section>
        </div>
      )}

      {showEdit && query.data && <ClockWheelModal wheel={query.data} onClose={() => setShowEdit(false)} />}

      {showDelete && query.data && (
        <Modal title="Delete clock wheel" onClose={() => setShowDelete(false)}>
          <p className="text-sm text-slate-600">Delete "{query.data.name}"? This cannot be undone.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowDelete(false)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => deleteMutation.mutate()}
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
