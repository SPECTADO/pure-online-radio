-- CreateTable
CREATE TABLE "StationSettings" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Spectado Radio',
    "description" TEXT,
    "logoKey" TEXT,
    "logoMimeType" TEXT,
    "links" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "StationSettings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StationSettings" ADD CONSTRAINT "StationSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
