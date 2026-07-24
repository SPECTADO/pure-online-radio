-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('SONG', 'JINGLE');

-- CreateEnum
CREATE TYPE "SelectionStrategy" AS ENUM ('RANDOM', 'LEAST_OFTEN_PLAYED');

-- CreateEnum
CREATE TYPE "JingleType" AS ENUM ('STATION_ID', 'SWEEPER', 'SFX', 'PROMO', 'ADVERT', 'OTHER');

-- CreateEnum
CREATE TYPE "ScheduledItemStatus" AS ENUM ('PENDING', 'PLAYED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExternalStreamStatus" AS ENUM ('SCHEDULED', 'PLAYING', 'STOPPED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SeparationRuleScope" AS ENUM ('GLOBAL', 'CLOCK_WHEEL');

-- CreateEnum
CREATE TYPE "PlaybackSource" AS ENUM ('CLOCK_WHEEL', 'SCHEDULED_ITEM', 'MANUAL', 'EXTERNAL_STREAM', 'LIVE_MIC');

-- CreateEnum
CREATE TYPE "PlaybackMediaKind" AS ENUM ('SONG', 'JINGLE', 'EXTERNAL_STREAM', 'LIVE_MIC');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MANAGER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Song" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "album" TEXT,
    "durationMs" INTEGER NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileMimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "coverArtKey" TEXT,
    "categoryId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "stationId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Song_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Jingle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "JingleType" NOT NULL DEFAULT 'OTHER',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "durationMs" INTEGER NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileMimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "stationId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Jingle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledItem" (
    "id" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "mediaKind" "MediaKind" NOT NULL,
    "songId" TEXT,
    "jingleId" TEXT,
    "status" "ScheduledItemStatus" NOT NULL DEFAULT 'PENDING',
    "stationId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playedAt" TIMESTAMP(3),

    CONSTRAINT "ScheduledItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClockWheel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "stationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClockWheel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClockWheelSlot" (
    "id" TEXT NOT NULL,
    "clockWheelId" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "startTime" TIME NOT NULL,
    "endTime" TIME NOT NULL,

    CONSTRAINT "ClockWheelSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClockWheelStep" (
    "id" TEXT NOT NULL,
    "clockWheelId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "mediaKind" "MediaKind" NOT NULL,
    "selectionStrategy" "SelectionStrategy" NOT NULL,
    "categoryId" TEXT,
    "tag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClockWheelStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeparationRule" (
    "id" TEXT NOT NULL,
    "scope" "SeparationRuleScope" NOT NULL DEFAULT 'GLOBAL',
    "clockWheelId" TEXT,
    "artistSeparationMinutes" INTEGER NOT NULL DEFAULT 60,
    "songSeparationMinutes" INTEGER NOT NULL DEFAULT 120,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "SeparationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalStream" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "ExternalStreamStatus" NOT NULL DEFAULT 'SCHEDULED',
    "stationId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalStream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybackHistoryEntry" (
    "id" TEXT NOT NULL,
    "mediaKind" "PlaybackMediaKind" NOT NULL,
    "songId" TEXT,
    "jingleId" TEXT,
    "externalStreamId" TEXT,
    "source" "PlaybackSource" NOT NULL,
    "clockWheelStepId" TEXT,
    "scheduledItemId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "titleSnapshot" TEXT NOT NULL,
    "artistSnapshot" TEXT,
    "stationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaybackHistoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "commandSubject" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Song_fileKey_key" ON "Song"("fileKey");

-- CreateIndex
CREATE INDEX "Song_categoryId_idx" ON "Song"("categoryId");

-- CreateIndex
CREATE INDEX "Song_artist_idx" ON "Song"("artist");

-- CreateIndex
CREATE UNIQUE INDEX "Jingle_fileKey_key" ON "Jingle"("fileKey");

-- CreateIndex
CREATE INDEX "Jingle_type_idx" ON "Jingle"("type");

-- CreateIndex
CREATE INDEX "ScheduledItem_scheduledFor_status_idx" ON "ScheduledItem"("scheduledFor", "status");

-- CreateIndex
CREATE INDEX "ClockWheelSlot_clockWheelId_idx" ON "ClockWheelSlot"("clockWheelId");

-- CreateIndex
CREATE UNIQUE INDEX "ClockWheelStep_clockWheelId_order_key" ON "ClockWheelStep"("clockWheelId", "order");

-- CreateIndex
CREATE INDEX "ExternalStream_startAt_endAt_idx" ON "ExternalStream"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "PlaybackHistoryEntry_songId_startedAt_idx" ON "PlaybackHistoryEntry"("songId", "startedAt");

-- CreateIndex
CREATE INDEX "PlaybackHistoryEntry_startedAt_idx" ON "PlaybackHistoryEntry"("startedAt");

-- CreateIndex
CREATE INDEX "CommandAuditLog_createdAt_idx" ON "CommandAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "CommandAuditLog_userId_idx" ON "CommandAuditLog"("userId");

-- AddForeignKey
ALTER TABLE "Song" ADD CONSTRAINT "Song_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Song" ADD CONSTRAINT "Song_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jingle" ADD CONSTRAINT "Jingle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledItem" ADD CONSTRAINT "ScheduledItem_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledItem" ADD CONSTRAINT "ScheduledItem_jingleId_fkey" FOREIGN KEY ("jingleId") REFERENCES "Jingle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledItem" ADD CONSTRAINT "ScheduledItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockWheelSlot" ADD CONSTRAINT "ClockWheelSlot_clockWheelId_fkey" FOREIGN KEY ("clockWheelId") REFERENCES "ClockWheel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockWheelStep" ADD CONSTRAINT "ClockWheelStep_clockWheelId_fkey" FOREIGN KEY ("clockWheelId") REFERENCES "ClockWheel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockWheelStep" ADD CONSTRAINT "ClockWheelStep_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeparationRule" ADD CONSTRAINT "SeparationRule_clockWheelId_fkey" FOREIGN KEY ("clockWheelId") REFERENCES "ClockWheel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeparationRule" ADD CONSTRAINT "SeparationRule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalStream" ADD CONSTRAINT "ExternalStream_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackHistoryEntry" ADD CONSTRAINT "PlaybackHistoryEntry_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackHistoryEntry" ADD CONSTRAINT "PlaybackHistoryEntry_jingleId_fkey" FOREIGN KEY ("jingleId") REFERENCES "Jingle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackHistoryEntry" ADD CONSTRAINT "PlaybackHistoryEntry_externalStreamId_fkey" FOREIGN KEY ("externalStreamId") REFERENCES "ExternalStream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackHistoryEntry" ADD CONSTRAINT "PlaybackHistoryEntry_clockWheelStepId_fkey" FOREIGN KEY ("clockWheelStepId") REFERENCES "ClockWheelStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackHistoryEntry" ADD CONSTRAINT "PlaybackHistoryEntry_scheduledItemId_fkey" FOREIGN KEY ("scheduledItemId") REFERENCES "ScheduledItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandAuditLog" ADD CONSTRAINT "CommandAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
