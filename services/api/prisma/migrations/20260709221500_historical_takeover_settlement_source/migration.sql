ALTER TABLE "Settlement"
  ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN "sourceTakeoverId" TEXT;

CREATE UNIQUE INDEX "Settlement_sourceTakeoverId_key"
  ON "Settlement"("sourceTakeoverId");
