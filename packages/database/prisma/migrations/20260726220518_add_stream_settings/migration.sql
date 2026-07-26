-- CreateEnum
CREATE TYPE "StreamCodec" AS ENUM ('AAC', 'MP3');

-- CreateTable
CREATE TABLE "StreamSettings" (
    "id" TEXT NOT NULL,
    "codec" "StreamCodec" NOT NULL DEFAULT 'AAC',
    "lowBitrateKbps" INTEGER NOT NULL DEFAULT 64,
    "highBitrateKbps" INTEGER NOT NULL DEFAULT 256,
    "segmentSeconds" INTEGER NOT NULL DEFAULT 4,
    "segmentCount" INTEGER NOT NULL DEFAULT 8,
    "lowLatencyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "StreamSettings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StreamSettings" ADD CONSTRAINT "StreamSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
