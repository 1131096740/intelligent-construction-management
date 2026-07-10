-- AlterTable
ALTER TABLE "FileObject"
ADD COLUMN "contentSha256" TEXT,
ADD COLUMN "storageStatus" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN "supersedesFileObjectId" TEXT;

-- CreateIndex
CREATE INDEX "FileObject_supersedesFileObjectId_idx" ON "FileObject"("supersedesFileObjectId");

-- CreateIndex
CREATE INDEX "FileObject_storageStatus_idx" ON "FileObject"("storageStatus");

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_supersedesFileObjectId_fkey" FOREIGN KEY ("supersedesFileObjectId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
