import { useConnectionStatus } from "../lib/natsClient";

const LABELS: Record<string, string> = {
  connected: "Live",
  connecting: "Connecting…",
  disconnected: "Offline",
  error: "Connection error",
};

const DOT_CLASSES: Record<string, string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-500 animate-pulse",
  disconnected: "bg-slate-400",
  error: "bg-red-500",
};

export function ConnectionStatusBadge() {
  const status = useConnectionStatus();

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
      <span className={`h-2 w-2 rounded-full ${DOT_CLASSES[status]}`} aria-hidden />
      {LABELS[status]}
    </span>
  );
}
