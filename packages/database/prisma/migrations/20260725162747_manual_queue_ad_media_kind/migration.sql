-- AlterEnum
ALTER TYPE "MediaKind" ADD VALUE 'AD';

-- AlterTable
ALTER TABLE "ScheduledItem" ADD COLUMN     "adId" TEXT,
ALTER COLUMN "scheduledFor" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ScheduledItem" ADD CONSTRAINT "ScheduledItem_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad"("id") ON DELETE SET NULL ON UPDATE CASCADE;
