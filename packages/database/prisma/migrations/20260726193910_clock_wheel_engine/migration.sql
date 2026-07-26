-- AlterEnum
ALTER TYPE "PlaybackMediaKind" ADD VALUE 'AD';

-- AlterEnum
BEGIN;
CREATE TYPE "SelectionStrategy_new" AS ENUM ('RANDOM', 'LEAST_RECENTLY_PLAYED', 'WEIGHTED_RECENCY');
ALTER TABLE "ClockWheelStep" ALTER COLUMN "selectionStrategy" TYPE "SelectionStrategy_new" USING ("selectionStrategy"::text::"SelectionStrategy_new");
ALTER TYPE "SelectionStrategy" RENAME TO "SelectionStrategy_old";
ALTER TYPE "SelectionStrategy_new" RENAME TO "SelectionStrategy";
DROP TYPE "public"."SelectionStrategy_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "ScheduledItem" DROP CONSTRAINT "ScheduledItem_createdById_fkey";

-- AlterTable
ALTER TABLE "ClockWheel" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rotationCursor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PlaybackHistoryEntry" ADD COLUMN     "adId" TEXT;

-- AlterTable
ALTER TABLE "ScheduledItem" ADD COLUMN     "clockWheelStepId" TEXT,
ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SeparationRule" ADD COLUMN     "albumSeparationMinutes" INTEGER NOT NULL DEFAULT 90;

-- AlterTable
ALTER TABLE "StationSettings" ADD COLUMN     "queuePlanningHorizonMinutes" INTEGER NOT NULL DEFAULT 240;

-- AddForeignKey
ALTER TABLE "ScheduledItem" ADD CONSTRAINT "ScheduledItem_clockWheelStepId_fkey" FOREIGN KEY ("clockWheelStepId") REFERENCES "ClockWheelStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledItem" ADD CONSTRAINT "ScheduledItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackHistoryEntry" ADD CONSTRAINT "PlaybackHistoryEntry_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad"("id") ON DELETE SET NULL ON UPDATE CASCADE;
