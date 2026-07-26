import { prisma } from "@spectado/database";
import type { StreamSettingsDTO } from "@spectado/shared-types";

/** There's only ever one row -- app enforces a single row via
 * findFirst-or-create, same pattern as StationSettings. */
export async function ensureStreamSettings() {
  const existing = await prisma.streamSettings.findFirst();
  if (existing) return existing;
  return prisma.streamSettings.create({ data: {} });
}

export function toStreamSettingsDTO(row: {
  codec: string;
  lowBitrateKbps: number;
  highBitrateKbps: number;
  segmentSeconds: number;
  segmentCount: number;
  lowLatencyEnabled: boolean;
  updatedAt: Date;
}): StreamSettingsDTO {
  return {
    codec: row.codec === "MP3" ? "MP3" : "AAC",
    lowBitrateKbps: row.lowBitrateKbps,
    highBitrateKbps: row.highBitrateKbps,
    segmentSeconds: row.segmentSeconds,
    segmentCount: row.segmentCount,
    lowLatencyEnabled: row.lowLatencyEnabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}
