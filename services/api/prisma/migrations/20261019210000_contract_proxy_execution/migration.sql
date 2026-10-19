BEGIN;
CREATE TABLE "ContractProxyExecution" (
 "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL REFERENCES "Project"("id"), "sourceRef" TEXT NOT NULL,
 "entryKind" TEXT NOT NULL CHECK ("entryKind" IN ('payment','refund','repayment')), "originalId" TEXT REFERENCES "ContractProxyExecution"("id"),
 "amountCents" BIGINT NOT NULL CHECK ("amountCents">0), "occurredAt" TIMESTAMP(3) NOT NULL,
 "actualPayerKey" TEXT NOT NULL, "bankReference" TEXT NOT NULL CHECK (length(btrim("bankReference"))>0),
 "evidenceFileId" TEXT NOT NULL REFERENCES "FileObject"("id"), "evidenceSha256" TEXT NOT NULL CHECK (length("evidenceSha256")=64),
 "reason" TEXT NOT NULL CHECK(length(btrim("reason"))>0), "paymentRequestId" TEXT REFERENCES "PaymentRequest"("id"),
 "frozenSource" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending_confirm' CHECK ("status" IN ('pending_confirm','confirmed','returned')),
 "recordedByUserId" TEXT NOT NULL REFERENCES "User"("id"), "confirmedByUserId" TEXT REFERENCES "User"("id"),
 "confirmedAt" TIMESTAMP(3), "confirmationSignatureVersionId" TEXT REFERENCES "HandwrittenSignatureVersion"("id"),
 "idempotencyKey" TEXT NOT NULL UNIQUE, "requestFingerprint" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("entryKind"='payment') = ("originalId" IS NULL)),
 CHECK ("confirmedByUserId" IS NULL OR "confirmedByUserId"<>"recordedByUserId"),
 CHECK ("status"<>'confirmed' OR ("confirmedAt" IS NOT NULL AND "confirmedByUserId" IS NOT NULL AND "confirmationSignatureVersionId" IS NOT NULL))
);
CREATE UNIQUE INDEX "ContractProxyExecution_active_bank_reference" ON "ContractProxyExecution"("actualPayerKey","bankReference") WHERE "status" <> 'returned';
CREATE INDEX "ContractProxyExecution_projectId_sourceRef_status_idx" ON "ContractProxyExecution"("projectId","sourceRef","status");
CREATE INDEX "ContractProxyExecution_originalId_status_idx" ON "ContractProxyExecution"("originalId","status");
CREATE FUNCTION guard_contract_proxy_execution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD."status"<>'pending_confirm' THEN RAISE EXCEPTION 'confirmed_proxy_execution_immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','confirmedByUserId','confirmedAt','confirmationSignatureVersionId']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','confirmedByUserId','confirmedAt','confirmationSignatureVersionId']) THEN RAISE EXCEPTION 'proxy_execution_source_immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "ContractProxyExecution_immutable" BEFORE UPDATE OR DELETE ON "ContractProxyExecution" FOR EACH ROW EXECUTE FUNCTION guard_contract_proxy_execution();
ALTER TABLE "ProjectFundingAllocation" DROP CONSTRAINT "ProjectFundingAllocation_execution_type_check", ADD CONSTRAINT "ProjectFundingAllocation_execution_type_check" CHECK ("executionType" IN ('payment_execution','project_expense_execution','spot_procurement_payment_execution','expense_claim_payment_execution','employee_loan_disbursement','fund_execution','fund_movement','contract_proxy_execution'));
ALTER FUNCTION jg_file_business_binding_columns() RENAME TO jg_file_business_binding_columns_before_contract_proxy;
CREATE FUNCTION jg_file_business_binding_columns() RETURNS TABLE ("tableName" TEXT,"columnName" TEXT,"exclusive" BOOLEAN) LANGUAGE sql STABLE PARALLEL SAFE AS $$
 SELECT * FROM jg_file_business_binding_columns_before_contract_proxy() UNION ALL VALUES ('ContractProxyExecution','evidenceFileId',TRUE);
$$;
CREATE TRIGGER jg_efb_contract_proxy_execution BEFORE INSERT ON "ContractProxyExecution" FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('evidenceFileId','true');
COMMIT;
