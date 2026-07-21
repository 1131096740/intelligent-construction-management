ALTER TABLE "ContractVersion"
  ADD COLUMN "copiedFromContractVersionId" TEXT;

ALTER TABLE "SettlementDraft"
  ADD COLUMN "copiedFromDraftId" TEXT;

CREATE INDEX "ContractVersion_copiedFromContractVersionId_idx"
  ON "ContractVersion"("copiedFromContractVersionId");

CREATE INDEX "SettlementDraft_copiedFromDraftId_idx"
  ON "SettlementDraft"("copiedFromDraftId");
