-- AlterEnum
ALTER TYPE "MediaKind" ADD VALUE 'VOICE_TRACK';

-- AlterEnum
ALTER TYPE "PlaybackMediaKind" ADD VALUE 'VOICE_TRACK';

-- AlterTable
ALTER TABLE "PlaybackHistoryEntry" ADD COLUMN     "voiceTrackId" TEXT;

-- AlterTable
ALTER TABLE "ScheduleRuleItem" ADD COLUMN     "voiceTrackId" TEXT;

-- AlterTable
ALTER TABLE "ScheduledItem" ADD COLUMN     "voiceTrackId" TEXT;

-- CreateTable
CREATE TABLE "VoiceTrack" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileMimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "stationId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceTrack_fileKey_key" ON "VoiceTrack"("fileKey");

-- AddForeignKey
ALTER TABLE "VoiceTrack" ADD CONSTRAINT "VoiceTrack_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledItem" ADD CONSTRAINT "ScheduledItem_voiceTrackId_fkey" FOREIGN KEY ("voiceTrackId") REFERENCES "VoiceTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRuleItem" ADD CONSTRAINT "ScheduleRuleItem_voiceTrackId_fkey" FOREIGN KEY ("voiceTrackId") REFERENCES "VoiceTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackHistoryEntry" ADD CONSTRAINT "PlaybackHistoryEntry_voiceTrackId_fkey" FOREIGN KEY ("voiceTrackId") REFERENCES "VoiceTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
