BEGIN;

ALTER TABLE "ContractFormalFile"
  DROP CONSTRAINT "ContractFormalFile_purpose_check";

ALTER TABLE "ContractFormalFile"
  ADD CONSTRAINT "ContractFormalFile_purpose_check"
  CHECK ("purpose" IN (
    'approval_original',
    'counterparty_signed',
    'counterparty_signed_preview',
    'mutually_signed_final'
  )) NOT VALID;

-- 乙方可一次上传多张原件；预览和审批/双方签署件仍各只保留一条 active 记录。
DROP INDEX "ContractFormalFile_active_purpose_key";

CREATE UNIQUE INDEX "ContractFormalFile_active_purpose_key"
  ON "ContractFormalFile"("contractVersionId", "purpose")
  WHERE "status" = 'active'
    AND "purpose" IN (
      'approval_original',
      'counterparty_signed_preview',
      'mutually_signed_final'
    );

COMMIT;
