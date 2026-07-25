import type { StationSettingsDTO } from "@spectado/shared-types";
import { apiUrl } from "../lib/apiClient";

export function StationHeader({ station }: { station: StationSettingsDTO | undefined }) {
  if (!station) return null;

  return (
    <header className="flex flex-col items-center gap-2 px-4 pt-6 text-center sm:pt-10">
      {station.logoUrl && (
        <img
          src={apiUrl(station.logoUrl)}
          alt=""
          className="h-14 w-14 rounded-xl object-cover shadow-md sm:h-20 sm:w-20"
        />
      )}
      <h1 className="text-lg font-semibold text-white sm:text-2xl">{station.name}</h1>
      {station.description && (
        <p className="max-w-sm text-xs text-slate-400 sm:max-w-md sm:text-sm">{station.description}</p>
      )}
    </header>
  );
}
