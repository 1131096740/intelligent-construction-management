BEGIN;

-- 付款申请增加“已签结算最近确认一期”依据。金额快照保留发起时的合同累计与占用，
-- 便于付款详单展示“发起快照 / 当前累计”差异。旧结算单仍使用 settlementId。
ALTER TABLE "PaymentRequest"
  ADD COLUMN "signedSettlementId" text,
  ADD COLUMN "signedSettlementConfirmationNo" bigint,
  ADD COLUMN "signedSettlementConfirmedYuan" numeric(24,4),
  ADD COLUMN "signedSettlementContractConfirmedYuan" numeric(24,4),
  ADD COLUMN "signedSettlementOccupiedCents" bigint,
  ADD COLUMN "signedSettlementBasisAt" timestamp(3);

-- 现有来源枚举与“结算来源 vs 结算外键”约束在旧迁移中只允许三种来源；
-- 本票新增 signed_settlement 必须在同一迁移内同步重建，否则付款申请写入
-- 会在数据库约束处失败，后端事务校验无法生效。
ALTER TABLE "PaymentRequest"
  DROP CONSTRAINT "PaymentRequest_sourceType_check";
ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_sourceType_check"
  CHECK ("sourceType" IN ('settlement', 'signed_settlement', 'contract_advance', 'contract_due'));

ALTER TABLE "PaymentRequest"
  DROP CONSTRAINT "PaymentRequest_source_settlement_check";
ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_source_settlement_check"
  CHECK (
    ("sourceType" = 'settlement' AND "settlementId" IS NOT NULL)
    OR ("sourceType" = 'signed_settlement' AND "settlementId" IS NULL)
    OR ("sourceType" IN ('contract_advance', 'contract_due') AND "settlementId" IS NULL)
  );

-- 依据来源互斥：已签结算付款不得再挂旧结算单，反之亦然；快照必须整组存在。
ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_signed_settlement_source_check" CHECK (
    ("sourceType" = 'signed_settlement') = ("signedSettlementId" IS NOT NULL)
    AND ("signedSettlementId" IS NULL OR "settlementId" IS NULL)
    AND (
      "signedSettlementId" IS NULL
      OR (
        "signedSettlementConfirmationNo" IS NOT NULL
        AND "signedSettlementConfirmedYuan" IS NOT NULL
        AND "signedSettlementContractConfirmedYuan" IS NOT NULL
        AND "signedSettlementOccupiedCents" IS NOT NULL
        AND "signedSettlementBasisAt" IS NOT NULL
      )
    )
  );

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_signedSettlementId_fkey"
  FOREIGN KEY ("signedSettlementId") REFERENCES "SignedContractSettlement"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "PaymentRequest_signedSettlementId_idx"
  ON "PaymentRequest"("signedSettlementId");

COMMIT;
