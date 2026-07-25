import { useQuery } from "@tanstack/react-query";
import type { StationSettingsDTO, TimeFormat } from "@spectado/shared-types";
import { apiClient } from "./apiClient";

/** Same query key as NavSidebar's station-name fetch, so this never triggers
 * an extra request -- react-query dedups by key across components. */
const STATION_KEY = ["public", "station"];

/** The station-wide 12h/24h clock display preference, set on the Station
 * Settings page and used by every clock time in the control panel
 * (lib/format.ts's formatTimeOfDay/formatDateTime). */
export function useTimeFormat(): TimeFormat {
  const query = useQuery({
    queryKey: STATION_KEY,
    queryFn: () => apiClient.get<StationSettingsDTO>("/public/station"),
  });
  return query.data?.timeFormat ?? "12h";
}
