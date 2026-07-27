import { useEncoderOnAirStatus, type EncoderOnAirStatus } from "../lib/useEncoderStatus";

const LABELS: Record<EncoderOnAirStatus, string> = {
  connecting: "Connecting…",
  offline: "Offline",
  "connection-error": "Connection error",
  checking: "Checking…",
  live: "Live",
  degraded: "Degraded",
  "off-air": "Off Air",
};

const DOT_CLASSES: Record<EncoderOnAirStatus, string> = {
  connecting: "bg-amber-500 animate-pulse",
  offline: "bg-slate-400",
  "connection-error": "bg-red-500",
  checking: "bg-amber-500 animate-pulse",
  live: "bg-emerald-500",
  degraded: "bg-amber-500",
  "off-air": "bg-slate-400",
};

export function EncoderStatusBadge() {
  const status = useEncoderOnAirStatus();

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
      <span className={`h-2 w-2 rounded-full ${DOT_CLASSES[status]}`} aria-hidden />
      {LABELS[status]}
    </span>
  );
}
