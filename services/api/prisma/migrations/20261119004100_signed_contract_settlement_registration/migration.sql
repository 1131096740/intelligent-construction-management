CREATE TABLE "SignedContractSettlement" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT,
  "contractKind" TEXT NOT NULL CHECK ("contractKind" IN ('downstream', 'outside_fact', 'upward')),
  "contractId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "number" TEXT,
  "amountYuan" DECIMAL(24,4),
  "state" TEXT NOT NULL DEFAULT 'draft' CHECK ("state" IN ('draft', 'pending_review', 'returned', 'confirmed')),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "reviewReason" TEXT,
  "confirmationNo" BIGINT,
  "confirmedContractSource" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SignedContractSettlement_submitted_check" CHECK (
    "state" = 'draft' OR (
      "submittedAt" IS NOT NULL AND "number" IS NOT NULL AND length(btrim("number")) > 0
      AND "amountYuan" IS NOT NULL AND "amountYuan" <> 0
    )
  ),
  CONSTRAINT "SignedContractSettlement_confirmation_check" CHECK (
    ("state" = 'confirmed' AND "confirmationNo" > 0 AND "confirmationNo" IS NOT NULL) OR
    ("state" <> 'confirmed' AND "confirmationNo" IS NULL)
  ),
  CONSTRAINT "SignedContractSettlement_confirmed_source_check" CHECK (
    ("state" <> 'confirmed' AND "confirmedContractSource" IS NULL) OR COALESCE(
      "state" = 'confirmed' AND "reviewedAt" IS NOT NULL AND "reviewedByUserId" IS NOT NULL
      AND jsonb_typeof("confirmedContractSource") = 'object'
      AND length(btrim("confirmedContractSource" ->> 'sourceRecordId')) > 0
      AND ("confirmedContractSource" ->> 'sourceVersion') ~ '^[1-9][0-9]*$'
      AND (("contractKind" = 'downstream' AND ("confirmedContractSource" ->> 'relationship') IN ('inside', 'outside'))
        OR ("contractKind" = 'outside_fact' AND ("confirmedContractSource" ->> 'relationship') = 'outside')
        OR ("contractKind" = 'upward' AND ("confirmedContractSource" ->> 'relationship') = 'upward')), FALSE)
  ),
  CONSTRAINT "SignedContractSettlement_contract_confirmation_key"
    UNIQUE ("contractKind", "contractId", "confirmationNo")
);

CREATE INDEX "SignedContractSettlement_project_state_idx"
 ON "SignedContractSettlement"("projectId", "state");
CREATE INDEX "SignedContractSettlement_contract_number_idx"
 ON "SignedContractSettlement"("contractKind", "contractId", "number");

CREATE TABLE "SignedContractSettlementAttachment" (
  "settlementId" TEXT NOT NULL REFERENCES "SignedContractSettlement"("id") ON DELETE RESTRICT,
  "fileId" TEXT NOT NULL REFERENCES "FileObject"("id") ON DELETE RESTRICT,
  "sha256" TEXT NOT NULL CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY ("settlementId", "fileId")
);

CREATE UNIQUE INDEX "SignedContractSettlementAttachment_fileId_key"
 ON "SignedContractSettlementAttachment"("fileId");

CREATE FUNCTION public.jg_guard_confirmed_signed_settlement() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD."state" = 'confirmed' THEN
    RAISE EXCEPTION '已确认结算不能编辑或作废' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "SignedContractSettlement_confirmed_immutable"
BEFORE UPDATE OR DELETE ON "SignedContractSettlement"
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_confirmed_signed_settlement();

CREATE FUNCTION public.jg_guard_signed_settlement_attachment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  settlement_id TEXT;
  settlement_state TEXT;
  settlement_project TEXT;
  settlement_owner TEXT;
  attached_file RECORD;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(190731, 13);
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '结算附件记录不能直接改写' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN settlement_id := OLD."settlementId";
  ELSE settlement_id := NEW."settlementId";
  END IF;
  SELECT "state", "projectId", "ownerUserId" INTO settlement_state, settlement_project, settlement_owner
    FROM public."SignedContractSettlement" WHERE "id" = settlement_id FOR UPDATE;
  IF settlement_state IS NULL OR settlement_state NOT IN ('draft', 'returned') THEN
    RAISE EXCEPTION '已提交的结算附件不能替换' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT "objectKey", "uploadedByUserId", "contentSha256", "storageStatus", "mimeType", "sizeBytes", "supersedesFileObjectId"
    INTO attached_file FROM public."FileObject" WHERE "id" = NEW."fileId" FOR UPDATE;
  IF NOT FOUND OR attached_file."uploadedByUserId" IS DISTINCT FROM settlement_owner
    OR attached_file."storageStatus" <> 'active' OR attached_file."contentSha256" IS DISTINCT FROM NEW."sha256"
    OR attached_file."mimeType" NOT IN ('application/pdf', 'image/png', 'image/jpeg')
    OR attached_file."sizeBytes" <= 0 OR attached_file."supersedesFileObjectId" IS NOT NULL
    OR NOT pg_catalog.starts_with(attached_file."objectKey", 'uploads/signed-contract-settlement/'
      || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(settlement_project, 'UTF8')), 'hex') || '/')
  THEN
    RAISE EXCEPTION '已签结算附件与原制单人、项目或原件校验不符'
      USING ERRCODE = '23514', CONSTRAINT = 'signed_settlement_attachment_eligibility';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.jg_guard_signed_settlement_attachment() FROM PUBLIC;

CREATE TRIGGER "SignedContractSettlementAttachment_frozen"
BEFORE INSERT OR UPDATE OR DELETE ON "SignedContractSettlementAttachment"
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_signed_settlement_attachment();

-- Reuse the established exclusive binding check against predecessor business records.
CREATE TRIGGER "SignedContractSettlementAttachment_legacy_collision"
BEFORE INSERT ON "SignedContractSettlementAttachment"
FOR EACH ROW EXECUTE FUNCTION public.jg_enforce_exclusive_file_business_binding('fileId', 'true');

CREATE FUNCTION public.jg_guard_signed_settlement_file_retention() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."objectKey" IS DISTINCT FROM OLD."objectKey" THEN
    RAISE EXCEPTION '已签结算原件的存储标识不能修改' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW."bucket", NEW."contentSha256", NEW."storageStatus", NEW."uploadedByUserId",
         NEW."supersedesFileObjectId", NEW."mimeType", NEW."sizeBytes", NEW."originalName", NEW."purgeReceiptId")
     IS DISTINCT FROM
     ROW(OLD."bucket", OLD."contentSha256", OLD."storageStatus", OLD."uploadedByUserId",
         OLD."supersedesFileObjectId", OLD."mimeType", OLD."sizeBytes", OLD."originalName", OLD."purgeReceiptId")
     AND EXISTS (SELECT 1 FROM public."SignedContractSettlementAttachment" WHERE "fileId" = OLD."id")
  THEN
    RAISE EXCEPTION '已绑定的结算原件不能替换或待清理' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FileObject_signed_settlement_retention"
BEFORE UPDATE ON "FileObject"
FOR EACH ROW
WHEN (OLD."objectKey" LIKE 'uploads/signed-contract-settlement/%' OR NEW."objectKey" LIKE 'uploads/signed-contract-settlement/%')
EXECUTE FUNCTION public.jg_guard_signed_settlement_file_retention();

CREATE FUNCTION public.jg_guard_signed_settlement_replacement_target() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."supersedesFileObjectId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."FileObject"
    WHERE "id" = NEW."supersedesFileObjectId" AND "objectKey" LIKE 'uploads/signed-contract-settlement/%'
  ) THEN
    RAISE EXCEPTION '已签结算原件不能加入文件替换链' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.jg_guard_signed_settlement_replacement_target() FROM PUBLIC;

CREATE TRIGGER "FileObject_signed_settlement_replacement_target"
BEFORE INSERT OR UPDATE OF "supersedesFileObjectId" ON "FileObject"
FOR EACH ROW
WHEN (NEW."supersedesFileObjectId" IS NOT NULL)
EXECUTE FUNCTION public.jg_guard_signed_settlement_replacement_target();
