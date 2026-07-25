import { useUploadQueueStore } from "../lib/uploadQueueStore";

const STATUS_LABEL: Record<string, string> = {
  queued: "waiting…",
  uploading: "uploading",
  done: "done",
  error: "failed",
};

/** Mounted once in AppShell -- persists across modal open/close and page
 * navigation, since uploads enqueued from a modal keep running after it's
 * closed. */
export function UploadQueueTray() {
  const items = useUploadQueueStore((s) => s.items);
  const dismiss = useUploadQueueStore((s) => s.dismiss);
  const clearFinished = useUploadQueueStore((s) => s.clearFinished);

  if (items.length === 0) return null;

  const activeCount = items.filter((i) => i.status === "queued" || i.status === "uploading").length;
  const hasFinished = items.some((i) => i.status === "done" || i.status === "error");

  return (
    <div className="fixed bottom-4 right-4 z-[90] w-80 rounded-lg border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <span className="text-sm font-medium text-slate-700">
          {activeCount > 0 ? `Uploading ${activeCount} file${activeCount === 1 ? "" : "s"}…` : "Uploads"}
        </span>
        {hasFinished && (
          <button
            type="button"
            onClick={clearFinished}
            className="text-xs font-medium text-slate-400 hover:text-slate-600"
          >
            Clear finished
          </button>
        )}
      </div>
      <ul className="max-h-72 overflow-y-auto p-2">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-1 px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm text-slate-700" title={item.filename}>
                {item.filename}
              </span>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss"
                className="shrink-0 text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all ${
                  item.status === "error"
                    ? "bg-red-500"
                    : item.status === "done"
                      ? "bg-emerald-500"
                      : "bg-slate-900"
                }`}
                style={{ width: `${item.status === "error" ? 100 : item.progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className={item.status === "error" ? "truncate text-red-600" : "text-slate-400"} title={item.error}>
                {item.status === "error" ? item.error : STATUS_LABEL[item.status]}
              </span>
              {(item.status === "queued" || item.status === "uploading") && (
                <span className="shrink-0 text-slate-400">{item.progress}%</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
