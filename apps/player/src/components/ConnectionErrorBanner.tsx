interface ConnectionErrorBannerProps {
  visible: boolean;
}

/** Subtle banner shown once now-playing polling has failed several times in a row. */
export function ConnectionErrorBanner({ visible }: ConnectionErrorBannerProps) {
  if (!visible) return null;

  return (
    <div className="rounded-lg border border-amber-900/50 bg-amber-950/50 px-4 py-2 text-center text-sm text-amber-300">
      Having trouble reaching the station. Retrying&hellip;
    </div>
  );
}
