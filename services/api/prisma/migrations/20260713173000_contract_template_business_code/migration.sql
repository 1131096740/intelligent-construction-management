ALTER TABLE "ContractBusinessTemplate"
  ADD COLUMN "businessCode" TEXT;

CREATE UNIQUE INDEX "ContractBusinessTemplate_businessCode_key"
  ON "ContractBusinessTemplate"("businessCode");
