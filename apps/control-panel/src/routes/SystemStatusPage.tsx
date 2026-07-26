import { useQuery } from "@tanstack/react-query";
import type {
  CategoryLibraryStatsDTO,
  ComponentHealth,
  ComponentStatusDTO,
  LibraryStatsDTO,
  MediaKindStatsDTO,
  StorageKindStatsDTO,
  StorageStatsDTO,
  SystemStatusDTO,
} from "@spectado/shared-types";
import { apiClient, ApiError } from "../lib/apiClient";
import { formatBytes, formatTimeOfDay, formatUptime } from "../lib/format";
import { useTimeFormat } from "../lib/useTimeFormat";

const STATUS_KEY = ["system-status"];

export function SystemStatusPage() {
  const timeFormat = useTimeFormat();
  const query = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => apiClient.get<SystemStatusDTO>("/status"),
    refetchInterval: 10_000,
  });

  const status = query.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">System Status</h1>
        {status && (
          <span className="text-sm text-slate-500">
            Updated {formatTimeOfDay(new Date(status.generatedAt).getTime(), timeFormat)}
          </span>
        )}
      </div>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {query.isError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load system status: {query.error instanceof ApiError ? query.error.message : "request failed"}
        </div>
      )}

      {status && (
        <>
          <ComponentsSection components={status.components} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {status.queuedItemCount !== null ? (
              <QueueSection count={status.queuedItemCount} />
            ) : (
              <UnavailableSection title="Queue" />
            )}
            <div className="lg:col-span-2">
              {status.library ? (
                <LibraryTotalsSection library={status.library} />
              ) : (
                <UnavailableSection title="Library" />
              )}
            </div>
          </div>
          {status.library ? (
            <CategoryBreakdownSection byCategory={status.library.byCategory} />
          ) : (
            <UnavailableSection title="Active items by category" />
          )}
          {status.storage ? (
            <StorageSection storage={status.storage} />
          ) : (
            <UnavailableSection title="Storage (MinIO)" />
          )}
        </>
      )}
    </div>
  );
}

const HEALTH_STYLES: Record<ComponentHealth, string> = {
  ok: "bg-green-100 text-green-800",
  degraded: "bg-yellow-100 text-yellow-800",
  error: "bg-red-100 text-red-800",
  unknown: "bg-slate-100 text-slate-500",
};

const HEALTH_LABELS: Record<ComponentHealth, string> = {
  ok: "Operational",
  degraded: "Degraded",
  error: "Down",
  unknown: "Unknown",
};

function ComponentsSection({ components }: { components: ComponentStatusDTO[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Components</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {components.map((component) => (
          <ComponentCard key={component.key} component={component} />
        ))}
      </div>
    </section>
  );
}

function ComponentCard({ component }: { component: ComponentStatusDTO }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-900">{component.label}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_STYLES[component.health]}`}>
          {HEALTH_LABELS[component.health]}
        </span>
      </div>
      <div className="text-sm text-slate-500">Uptime: {formatUptime(component.uptimeSec)}</div>
      {component.message && <div className="text-xs text-red-600">{component.message}</div>}
    </div>
  );
}

/** Rendered in place of a section whose data came back null -- its backing
 * service was unreachable when /status gathered stats (see the matching
 * "Down"/"error" component card above for which one). */
function UnavailableSection({ title }: { title: string }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      <p className="text-sm text-slate-500">Unavailable right now.</p>
    </section>
  );
}

function QueueSection({ count }: { count: number }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Queue</h2>
      <div className="text-3xl font-semibold tabular-nums text-slate-900">{count}</div>
      <p className="mt-1 text-sm text-slate-500">item{count === 1 ? "" : "s"} waiting to play</p>
    </section>
  );
}

const LIBRARY_ROWS: { key: keyof LibraryStatsDTO; label: string }[] = [
  { key: "songs", label: "Songs" },
  { key: "jingles", label: "Jingles" },
  { key: "ads", label: "Ads" },
];

function LibraryTotalsSection({ library }: { library: LibraryStatsDTO }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Library</h2>
      <div className="flex flex-col gap-3">
        {LIBRARY_ROWS.map((row) => {
          const stats = library[row.key] as MediaKindStatsDTO;
          return (
            <div key={row.key} className="flex items-center justify-between text-sm">
              <span className="text-slate-700">{row.label}</span>
              <span className="tabular-nums text-slate-500">
                <span className="font-medium text-slate-900">{stats.active}</span> active / {stats.total} total
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CategoryBreakdownSection({ byCategory }: { byCategory: CategoryLibraryStatsDTO[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Active items by category
      </h2>

      {byCategory.length === 0 ? (
        <p className="text-sm text-slate-500">No categories yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Songs</th>
                <th className="px-4 py-3 text-right">Jingles</th>
                <th className="px-4 py-3 text-right">Ads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byCategory.map((category) => (
                <tr key={category.categoryId}>
                  <td className="px-4 py-3 font-medium text-slate-900">{category.categoryName}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{category.activeSongs}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{category.activeJingles}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{category.activeAds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const STORAGE_ROWS: { key: "songs" | "jingles" | "ads"; label: string }[] = [
  { key: "songs", label: "Songs" },
  { key: "jingles", label: "Jingles" },
  { key: "ads", label: "Ads" },
];

function StorageSection({ storage }: { storage: StorageStatsDTO }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Storage (MinIO)</h2>
        <span className="text-sm text-slate-500">
          <span className="font-medium text-slate-900">{formatBytes(storage.totalBytes)}</span> across{" "}
          {storage.totalObjectCount} object{storage.totalObjectCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3 text-right">Objects</th>
              <th className="px-4 py-3 text-right">Size</th>
              <th className="px-4 py-3 text-right">Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {STORAGE_ROWS.map((row) => {
              const stats = storage[row.key] as StorageKindStatsDTO;
              const share = storage.totalBytes > 0 ? (stats.totalBytes / storage.totalBytes) * 100 : 0;
              return (
                <tr key={row.key}>
                  <td className="px-4 py-3 font-medium text-slate-900">{row.label}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{stats.objectCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatBytes(stats.totalBytes)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-400">{share.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Totals reflect everything in the bucket (including cover art and the station logo), not just the three media
        types broken out above.
      </p>
    </section>
  );
}
