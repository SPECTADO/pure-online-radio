/*
  Warnings:

  - You are about to drop the column `startAt` on the `ExternalStream` table. All the data in the column will be lost.
  - Added the required column `triggerType` to the `ExternalStream` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ScheduleTriggerType" AS ENUM ('ONE_TIME', 'WEEKLY', 'INTERVAL', 'PLAY_COUNT');

-- CreateEnum
CREATE TYPE "ScheduleInsertionMode" AS ENUM ('ASAP', 'AT_TIME');

-- CreateEnum
CREATE TYPE "ExternalStreamEndBehavior" AS ENUM ('NATURAL', 'AT_TIME', 'AFTER_DURATION');

-- DropIndex
DROP INDEX "ExternalStream_startAt_endAt_idx";

-- AlterTable
ALTER TABLE "ExternalStream" DROP COLUMN "startAt",
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "endBehavior" "ExternalStreamEndBehavior" NOT NULL DEFAULT 'NATURAL',
ADD COLUMN     "everyNPlays" INTEGER,
ADD COLUMN     "insertionMode" "ScheduleInsertionMode" NOT NULL DEFAULT 'ASAP',
ADD COLUMN     "intervalMinutes" INTEGER,
ADD COLUMN     "lastTriggeredAt" TIMESTAMP(3),
ADD COLUMN     "playsSinceLastTrigger" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "runAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "timeOfDay" TIME,
ADD COLUMN     "triggerType" "ScheduleTriggerType" NOT NULL,
ADD COLUMN     "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "windowEnd" TIME,
ADD COLUMN     "windowStart" TIME,
ALTER COLUMN "endAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ScheduledItem" ADD COLUMN     "scheduleRuleId" TEXT;

-- CreateTable
CREATE TABLE "ScheduleRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "triggerType" "ScheduleTriggerType" NOT NULL,
    "insertionMode" "ScheduleInsertionMode" NOT NULL DEFAULT 'ASAP',
    "runAt" TIMESTAMP(3),
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "timeOfDay" TIME,
    "intervalMinutes" INTEGER,
    "windowStart" TIME,
    "windowEnd" TIME,
    "everyNPlays" INTEGER,
    "playsSinceLastTrigger" INTEGER NOT NULL DEFAULT 0,
    "lastTriggeredAt" TIMESTAMP(3),
    "stationId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleRuleItem" (
    "id" TEXT NOT NULL,
    "scheduleRuleId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "mediaKind" "MediaKind" NOT NULL,
    "songId" TEXT,
    "jingleId" TEXT,
    "adId" TEXT,

    CONSTRAINT "ScheduleRuleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleRule_triggerType_isActive_idx" ON "ScheduleRule"("triggerType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleRuleItem_scheduleRuleId_order_key" ON "ScheduleRuleItem"("scheduleRuleId", "order");

-- CreateIndex
CREATE INDEX "ExternalStream_triggerType_status_idx" ON "ExternalStream"("triggerType", "status");

-- AddForeignKey
ALTER TABLE "ScheduledItem" ADD CONSTRAINT "ScheduledItem_scheduleRuleId_fkey" FOREIGN KEY ("scheduleRuleId") REFERENCES "ScheduleRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRule" ADD CONSTRAINT "ScheduleRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRuleItem" ADD CONSTRAINT "ScheduleRuleItem_scheduleRuleId_fkey" FOREIGN KEY ("scheduleRuleId") REFERENCES "ScheduleRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRuleItem" ADD CONSTRAINT "ScheduleRuleItem_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRuleItem" ADD CONSTRAINT "ScheduleRuleItem_jingleId_fkey" FOREIGN KEY ("jingleId") REFERENCES "Jingle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRuleItem" ADD CONSTRAINT "ScheduleRuleItem_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad"("id") ON DELETE SET NULL ON UPDATE CASCADE;
