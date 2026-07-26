import { prisma } from "@spectado/database";
import { type StationLinkDTO, type StationSettingsDTO } from "@spectado/shared-types";

/** There's only ever one station -- app enforces a single row via
 * findFirst-or-create, same pattern as the single GLOBAL SeparationRule. */
export async function ensureStationSettings() {
  const existing = await prisma.stationSettings.findFirst();
  if (existing) return existing;
  return prisma.stationSettings.create({ data: {} });
}

export function toStationSettingsDTO(row: {
  name: string;
  description: string | null;
  logoKey: string | null;
  links: unknown;
  timeFormat: string;
  queuePlanningHorizonMinutes: number;
  updatedAt: Date;
}): StationSettingsDTO {
  return {
    name: row.name,
    description: row.description,
    logoUrl: row.logoKey ? "/public/station/logo" : null,
    links: (row.links as StationLinkDTO[] | null) ?? [],
    timeFormat: row.timeFormat === "24h" ? "24h" : "12h",
    queuePlanningHorizonMinutes: row.queuePlanningHorizonMinutes,
    updatedAt: row.updatedAt.toISOString(),
  };
}
