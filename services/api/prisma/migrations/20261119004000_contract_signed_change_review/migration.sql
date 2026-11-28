BEGIN;

ALTER TABLE "ContractFormalFile"
  DROP CONSTRAINT "ContractFormalFile_purpose_check",
  ADD CONSTRAINT "ContractFormalFile_purpose_check" CHECK (
    "purpose" IN ('approval_original', 'mutually_signed_final', 'counterparty_signed', 'counterparty_signed_preview', 'signed_change_appendix')
  ) NOT VALID;

CREATE TABLE "ContractSignedChange" (
  "id" TEXT PRIMARY KEY,
  "contractId" TEXT NOT NULL REFERENCES "Contract"("id") ON DELETE RESTRICT,
  "baseVersionId" TEXT NOT NULL REFERENCES "ContractVersion"("id") ON DELETE RESTRICT,
  "appendixFormalFileId" TEXT NOT NULL UNIQUE REFERENCES "ContractFormalFile"("id") ON DELETE RESTRICT,
  "sequenceNo" INTEGER NOT NULL CHECK ("sequenceNo" > 0),
  "status" TEXT NOT NULL DEFAULT 'pending_review' CHECK ("status" IN ('pending_review', 'approved', 'rejected')),
  "summary" TEXT NOT NULL CHECK (btrim("summary") <> ''),
  "paymentAgreementText" TEXT CHECK (btrim("paymentAgreementText") <> ''),
  "amountDeltaYuan" DECIMAL(24,4) NOT NULL,
  "precedingAmountYuan" DECIMAL(24,4) CHECK ("precedingAmountYuan" >= 0),
  "effectiveAmountYuan" DECIMAL(24,4) CHECK ("effectiveAmountYuan" >= 0),
  "submittedByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "reviewedByUserId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT,
  "reviewReason" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractSignedChange_contractId_sequenceNo_key" UNIQUE ("contractId", "sequenceNo"),
  CONSTRAINT "ContractSignedChange_review_check" CHECK (
    ("status" = 'pending_review' AND "reviewedByUserId" IS NULL AND "reviewedAt" IS NULL AND "reviewReason" IS NULL)
    OR ("status" = 'approved' AND "reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewReason" IS NULL)
    OR ("status" = 'rejected' AND "reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND coalesce(btrim("reviewReason"), '') <> '')
  ),
  CONSTRAINT "ContractSignedChange_amount_check" CHECK (
    ("precedingAmountYuan" IS NULL AND "effectiveAmountYuan" IS NULL)
    OR ("precedingAmountYuan" IS NOT NULL AND "effectiveAmountYuan" IS NOT NULL
      AND "precedingAmountYuan" + "amountDeltaYuan" = "effectiveAmountYuan")
  )
);
CREATE INDEX "ContractSignedChange_contractId_status_sequenceNo_idx"
  ON "ContractSignedChange"("contractId", "status", "sequenceNo");
CREATE UNIQUE INDEX "ContractSignedChange_one_pending"
  ON "ContractSignedChange"("contractId") WHERE "status" = 'pending_review';

CREATE FUNCTION jg_contract_signed_change_history_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '已提交的补充协议记录不可删除' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" <> 'pending_review'
      OR NEW."status" NOT IN ('approved', 'rejected')
      OR (to_jsonb(NEW) - ARRAY['status', 'reviewedByUserId', 'reviewedAt', 'reviewReason'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'reviewedByUserId', 'reviewedAt', 'reviewReason']) THEN
      RAISE EXCEPTION '补充协议提交事实或复核结果不可覆写' USING ERRCODE = '23514';
    END IF;
    IF NEW."status" = 'approved' AND NOT EXISTS (
      SELECT 1 FROM public."ContractVersion" v
      JOIN public."ContractFormalFile" f ON f."contractVersionId" = v."id"
      WHERE v."id" = NEW."baseVersionId" AND v."contractId" = NEW."contractId"
        AND v."status" = 'effective' AND f."id" = NEW."appendixFormalFileId"
        AND f."purpose" = 'signed_change_appendix' AND f."status" = 'active'
        AND f."confirmedByUserId" = NEW."reviewedByUserId" AND f."confirmedAt" = NEW."reviewedAt"
        AND f."confirmationSnapshot"->>'changeId' = NEW."id"
    ) THEN
      RAISE EXCEPTION '补充协议生效缺少同一文件及主管复核' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" <> 'pending_review' OR NOT EXISTS (
    SELECT 1 FROM public."ContractVersion" v
    JOIN public."ContractFormalFile" f ON f."contractVersionId" = v."id"
    WHERE v."id" = NEW."baseVersionId" AND v."contractId" = NEW."contractId"
      AND v."status" = 'effective' AND f."id" = NEW."appendixFormalFileId"
      AND f."purpose" = 'signed_change_appendix' AND f."status" = 'active'
      AND f."uploadedByUserId" = NEW."submittedByUserId"
  ) THEN
    RAISE EXCEPTION '补充协议必须绑定当前合同及本人提交的签署原件' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER jg_contract_signed_change_history
  BEFORE INSERT OR UPDATE OR DELETE ON "ContractSignedChange"
  FOR EACH ROW EXECUTE FUNCTION jg_contract_signed_change_history_guard();

CREATE TABLE "PaymentRequestAgreementSnapshot" (
  "paymentRequestId" TEXT PRIMARY KEY REFERENCES "PaymentRequest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "agreementText" TEXT NOT NULL
);
REVOKE ALL ON TABLE "PaymentRequestAgreementSnapshot" FROM PUBLIC;

CREATE FUNCTION jg_freeze_signed_payment_agreement_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- Every payment creation lane locks the same Contract row used by signed change review.
  INSERT INTO public."PaymentRequestAgreementSnapshot" ("paymentRequestId", "agreementText")
  SELECT NEW."id", change."paymentAgreementText"
  FROM public."ContractSignedChange" AS change
  WHERE change."contractId" = NEW."contractId" AND change."status" = 'approved'
    AND change."paymentAgreementText" IS NOT NULL
  ORDER BY change."sequenceNo" DESC LIMIT 1;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION jg_freeze_signed_payment_agreement_v1() FROM PUBLIC;

CREATE TRIGGER jg_freeze_signed_payment_agreement
  AFTER INSERT ON "PaymentRequest"
  FOR EACH ROW EXECUTE FUNCTION jg_freeze_signed_payment_agreement_v1();

CREATE FUNCTION jg_payment_agreement_snapshot_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '付款申请提交时的付款约定不可修改或删除' USING ERRCODE = '23514';
END;
$$;

REVOKE ALL ON FUNCTION jg_payment_agreement_snapshot_immutable() FROM PUBLIC;

CREATE TRIGGER jg_payment_agreement_snapshot_immutable
  BEFORE UPDATE OR DELETE ON "PaymentRequestAgreementSnapshot"
  FOR EACH ROW EXECUTE FUNCTION jg_payment_agreement_snapshot_immutable();

ALTER TABLE "ContractTaxFactRevision"
  DROP CONSTRAINT "ContractTaxFactRevision_source_check";
ALTER TABLE "ContractTaxFactRevision"
  ADD CONSTRAINT "ContractTaxFactRevision_source_check"
  CHECK ("source" IS NULL OR "source" IN (
    'contract_document', 'supplement_evidence', 'business_finance_confirmation', 'ordinary_contract'
  )) NOT VALID;

CREATE FUNCTION jg_ordinary_contract_tax_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."source" = 'ordinary_contract' AND NOT (
      (NEW."kind" = 'supplement' AND NEW."status" = 'confirmed'
        AND NEW."confirmedByUserId" IS NOT DISTINCT FROM NEW."createdByUserId" AND NEW."confirmedAt" IS NOT NULL)
      OR (NEW."kind" = 'correction' AND NEW."status" = 'pending_contract_confirmation'
        AND NEW."confirmedByUserId" IS NULL AND NEW."confirmedAt" IS NULL)
    ) THEN
      RAISE EXCEPTION '普通合同税务记录初始状态无效' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD."source" = 'ordinary_contract' THEN
      RAISE EXCEPTION '普通合同税务记录不可删除' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW."source" = 'ordinary_contract' AND OLD."source" IS DISTINCT FROM 'ordinary_contract') OR (
    OLD."source" = 'ordinary_contract' AND NOT (
      OLD."kind" = 'correction' AND OLD."status" = 'pending_contract_confirmation'
      AND NEW."status" IN ('confirmed', 'rejected') AND NEW."confirmedByUserId" IS NOT NULL AND NEW."confirmedAt" IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['status','confirmedByUserId','confirmedAt','contractReviewComment','updatedAt'])
        = (to_jsonb(OLD) - ARRAY['status','confirmedByUserId','confirmedAt','contractReviewComment','updatedAt'])
    )
  ) THEN
    RAISE EXCEPTION '普通合同税务记录只允许完成一次复核' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION jg_ordinary_contract_tax_revision_guard() FROM PUBLIC;
CREATE TRIGGER jg_ordinary_contract_tax_revision_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "ContractTaxFactRevision"
  FOR EACH ROW EXECUTE FUNCTION jg_ordinary_contract_tax_revision_guard();

COMMIT;
