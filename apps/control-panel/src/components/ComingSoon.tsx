interface ComingSoonProps {
  title: string;
  detail?: string;
}

/** Clean empty state for pages whose backing API route is registered but
 * still returns 501, or that simply have no data yet. */
export function ComingSoon({ title, detail }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center">
      <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Coming soon
      </div>
      <h2 className="text-lg font-medium text-slate-700">{title}</h2>
      {detail && <p className="mt-2 max-w-md text-sm text-slate-500">{detail}</p>}
    </div>
  );
}
