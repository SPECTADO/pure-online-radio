-- AlterTable
ALTER TABLE "Song" ADD COLUMN     "mixInDurationMs" INTEGER,
ADD COLUMN     "mixInPointMs" INTEGER,
ADD COLUMN     "mixOutDurationMs" INTEGER,
ADD COLUMN     "mixOutPointMs" INTEGER;

-- AlterTable
ALTER TABLE "StationSettings" ADD COLUMN     "defaultMixInDurationMs" INTEGER NOT NULL DEFAULT 5000,
ADD COLUMN     "defaultMixOutDurationMs" INTEGER NOT NULL DEFAULT 5000;
