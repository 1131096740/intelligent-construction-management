CREATE TABLE "BusinessDailySequence" (
  "prefix" TEXT NOT NULL,
  "businessDate" TEXT NOT NULL,
  "nextSequence" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessDailySequence_pkey" PRIMARY KEY ("prefix", "businessDate")
);
