-- CreateTable
CREATE TABLE "ScratchPad" (
    "id" TEXT NOT NULL,
    "slots" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ScratchPad_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ScratchPad" ADD CONSTRAINT "ScratchPad_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
