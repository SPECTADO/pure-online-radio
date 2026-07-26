import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ClockWheelDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { ComingSoon } from "../components/ComingSoon";
import { ClockWheelWeekGrid } from "../components/ClockWheelWeekGrid";
import { ClockWheelModal } from "../components/ClockWheelModal";

export function ClockWheelsListPage() {
  const [showCreate, setShowCreate] = useState(false);

  const query = useQuery({
    queryKey: ["clock-wheels"],
    queryFn: () => apiClient.get<ClockWheelDTO[]>("/clock-wheels"),
    retry: false,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Clock Wheels</h1>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          New Clock Wheel
        </button>
      </div>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {query.isError && query.error instanceof ApiError && query.error.isNotImplemented && (
        <ComingSoon
          title="Clock wheels"
          detail="Programming a rotation of song/jingle pick-rules per time slot isn't implemented yet."
        />
      )}

      {query.isError && !(query.error instanceof ApiError && query.error.isNotImplemented) && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load clock wheels: {(query.error as Error).message}
        </div>
      )}

      {query.data && <ClockWheelWeekGrid wheels={query.data} />}

      {query.data && query.data.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {query.data.map((wheel) => (
            <Link
              key={wheel.id}
              to={`/clock-wheels/${wheel.id}`}
              className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-medium text-slate-900">{wheel.name}</h2>
                {wheel.isDefault ? (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">default</span>
                ) : wheel.isActive ? (
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                    active
                  </span>
                ) : (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    inactive
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {wheel.slots.length} slot{wheel.slots.length === 1 ? "" : "s"} &middot;{" "}
                {wheel.steps.length} step{wheel.steps.length === 1 ? "" : "s"}
              </p>
            </Link>
          ))}
        </div>
      )}

      {showCreate && <ClockWheelModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
