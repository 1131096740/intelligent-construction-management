BEGIN;
CREATE TABLE "UpwardContractAmountRevision" (
 "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL REFERENCES "Project"("id"), "contractId" TEXT NOT NULL REFERENCES "ProjectAffiliateCompanyContract"("id"),
 "supersedesId" TEXT REFERENCES "UpwardContractAmountRevision"("id"), "amountNature" TEXT NOT NULL CHECK("amountNature" IN ('fixed','uncapped')),
 "amountCents" BIGINT, "effectiveAt" TIMESTAMP(3) NOT NULL,
 "reason" TEXT NOT NULL CHECK(length(btrim("reason"))>0), "evidenceFileId" TEXT NOT NULL REFERENCES "FileObject"("id"), "evidenceSha256" TEXT NOT NULL CHECK(length("evidenceSha256")=64),
 "status" TEXT NOT NULL DEFAULT 'pending_confirm' CHECK("status" IN ('pending_confirm','confirmed','returned')),
 "recordedByUserId" TEXT NOT NULL REFERENCES "User"("id"), "confirmedByUserId" TEXT REFERENCES "User"("id"), "confirmedAt" TIMESTAMP(3),
 "confirmationSignatureVersionId" TEXT REFERENCES "HandwrittenSignatureVersion"("id"),
 "idempotencyKey" TEXT NOT NULL UNIQUE, "requestFingerprint" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(("amountNature"='fixed' AND "amountCents" IS NOT NULL AND "amountCents">=0) OR ("amountNature"='uncapped' AND "amountCents" IS NULL)),
 CHECK("status"<>'confirmed' OR ("confirmedByUserId" IS NOT NULL AND "confirmedByUserId"<>"recordedByUserId" AND "confirmedAt" IS NOT NULL AND "confirmationSignatureVersionId" IS NOT NULL))
);
CREATE INDEX "UpwardContractAmountRevision_projectId_contractId_status_effectiveAt_idx" ON "UpwardContractAmountRevision"("projectId","contractId","status","effectiveAt");
CREATE UNIQUE INDEX "UpwardContractAmountRevision_one_pending" ON "UpwardContractAmountRevision"("contractId") WHERE "status"='pending_confirm';
CREATE FUNCTION guard_upward_contract_amount_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD."status"<>'pending_confirm' THEN RAISE EXCEPTION 'upward_amount_revision_immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','confirmedByUserId','confirmedAt','confirmationSignatureVersionId']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','confirmedByUserId','confirmedAt','confirmationSignatureVersionId']) THEN RAISE EXCEPTION 'upward_amount_revision_source_immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "UpwardContractAmountRevision_immutable" BEFORE UPDATE OR DELETE ON "UpwardContractAmountRevision" FOR EACH ROW EXECUTE FUNCTION guard_upward_contract_amount_revision();
ALTER FUNCTION jg_file_business_binding_columns() RENAME TO jg_file_business_binding_columns_before_upward_amount;
CREATE FUNCTION jg_file_business_binding_columns() RETURNS TABLE ("tableName" TEXT,"columnName" TEXT,"exclusive" BOOLEAN) LANGUAGE sql STABLE PARALLEL SAFE AS $$
 SELECT * FROM jg_file_business_binding_columns_before_upward_amount() UNION ALL VALUES ('UpwardContractAmountRevision','evidenceFileId',TRUE);
$$;
CREATE TRIGGER jg_efb_upward_amount BEFORE INSERT ON "UpwardContractAmountRevision" FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('evidenceFileId','true');
COMMIT;
