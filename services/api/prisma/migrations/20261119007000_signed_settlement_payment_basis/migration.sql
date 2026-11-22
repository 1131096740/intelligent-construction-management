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
