CREATE TABLE "SettlementLine" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "contractBillRowId" TEXT,
  "sourceType" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "unit" TEXT,
  "quantity" DECIMAL(24, 6),
  "unitPriceCents" INTEGER,
  "amountCents" INTEGER NOT NULL,
  "reason" TEXT,
  "remark" TEXT,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SettlementLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SettlementLine_settlementId_sortOrder_idx" ON "SettlementLine"("settlementId", "sortOrder");
CREATE INDEX "SettlementLine_contractBillRowId_idx" ON "SettlementLine"("contractBillRowId");

ALTER TABLE "SettlementLine"
  ADD CONSTRAINT "SettlementLine_settlement_fk"
  FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") NOT VALID;

ALTER TABLE "SettlementLine"
  ADD CONSTRAINT "SettlementLine_contract_bill_row_fk"
  FOREIGN KEY ("contractBillRowId") REFERENCES "ContractBillRow"("id") NOT VALID;

ALTER TABLE "SettlementLine"
  ADD CONSTRAINT "SettlementLine_source_type_check"
  CHECK ("sourceType" IN ('contract_bill_row', 'manual_adjustment')) NOT VALID;

ALTER TABLE "SettlementLine"
  ADD CONSTRAINT "SettlementLine_amount_nonzero_check"
  CHECK ("amountCents" <> 0) NOT VALID;

ALTER TABLE "SettlementLine"
  ADD CONSTRAINT "SettlementLine_manual_reason_check"
  CHECK ("sourceType" <> 'manual_adjustment' OR NULLIF(BTRIM(COALESCE("reason", '')), '') IS NOT NULL) NOT VALID;

ALTER TABLE "SettlementLine"
  ADD CONSTRAINT "SettlementLine_contract_row_required_check"
  CHECK ("sourceType" <> 'contract_bill_row' OR "contractBillRowId" IS NOT NULL) NOT VALID;
