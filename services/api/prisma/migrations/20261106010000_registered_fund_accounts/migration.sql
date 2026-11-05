-- PREPARED SOURCE ONLY. Execution requires separate migration authorization.
-- No legacy fund/project/company foreign key is relaxed and no legacy balance is inferred.
CREATE TABLE "RegisteredFundAccount" (
 "id" TEXT PRIMARY KEY, "scopeKey" TEXT NOT NULL UNIQUE, "kind" TEXT NOT NULL,
 "companyEntityId" TEXT UNIQUE REFERENCES "CompanyEntity"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "RegisteredFundAccount_identity_check" CHECK (
   ("kind" = 'company' AND "companyEntityId" IS NOT NULL AND "scopeKey" = 'company:' || "companyEntityId") OR
   ("kind" = 'public_cash' AND "companyEntityId" IS NULL AND "scopeKey" = 'public_cash'))
);
CREATE TABLE "FundAccountBalanceRegistration" (
 "id" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL REFERENCES "RegisteredFundAccount"("id") ON DELETE RESTRICT,
 "version" INTEGER NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL,
 "approvalInstanceId" TEXT UNIQUE REFERENCES "ApprovalInstance"("id") ON DELETE RESTRICT,
 "previousRegistrationId" TEXT, "balanceYuan" DECIMAL(24,4), "asOfDate" TEXT NOT NULL,
 "evidenceReference" TEXT NOT NULL, "reconciliationNote" TEXT NOT NULL, "reason" TEXT NOT NULL,
 "idempotencyKey" TEXT NOT NULL UNIQUE, "payloadFingerprint" TEXT NOT NULL,
 "createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "confirmedByUserId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT,
 "confirmedAt" TIMESTAMP(3), "reviewNote" TEXT,
 "closedByUserId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT, "closedAt" TIMESTAMP(3), "closeReason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("accountId", "version"), UNIQUE ("id", "accountId"),
 FOREIGN KEY ("previousRegistrationId", "accountId") REFERENCES "FundAccountBalanceRegistration"("id", "accountId") ON DELETE RESTRICT,
 CHECK (("kind" = 'opening' AND "approvalInstanceId" IS NULL) OR ("kind" = 'correction' AND "approvalInstanceId" IS NOT NULL)),
 CHECK (("kind" = 'opening' AND "version" = 1 AND "previousRegistrationId" IS NULL AND "status" = 'confirmed') OR
        ("kind" = 'correction' AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" IN ('pending_review', 'confirmed', 'returned', 'withdrawn'))),
 CHECK ("balanceYuan" IS NULL OR ("balanceYuan" >= 0 AND "balanceYuan" <> 'NaN'::numeric)),
 CHECK (length(btrim("evidenceReference")) > 0 AND length(btrim("reconciliationNote")) > 0 AND length(btrim("reason")) > 0 AND length(btrim("idempotencyKey")) > 0),
 CHECK ("asOfDate" ~ '^\d{4}-\d{2}-\d{2}$'),
 CHECK (("status" = 'confirmed' AND "confirmedByUserId" IS NOT NULL AND "confirmedAt" IS NOT NULL) OR
        ("status" IN ('pending_review', 'returned', 'withdrawn') AND "confirmedByUserId" IS NULL AND "confirmedAt" IS NULL)),
 CHECK (("status" IN ('returned', 'withdrawn') AND "closedByUserId" IS NOT NULL AND "closedAt" IS NOT NULL AND "closeReason" IS NOT NULL AND length(btrim("closeReason")) > 0) OR ("status" IN ('pending_review', 'confirmed') AND "closedByUserId" IS NULL AND "closedAt" IS NULL AND "closeReason" IS NULL)),
 CHECK ("kind" <> 'correction' OR "status" <> 'confirmed' OR ("reviewNote" IS NOT NULL AND length(btrim("reviewNote")) > 0))
);
-- NULL predecessors never enforce a single root by themselves.
CREATE UNIQUE INDEX "FundAccountBalanceRegistration_one_opening" ON "FundAccountBalanceRegistration"("accountId") WHERE "kind" = 'opening';
CREATE UNIQUE INDEX "FundAccountBalanceRegistration_one_confirmed_successor" ON "FundAccountBalanceRegistration"("previousRegistrationId") WHERE "status" = 'confirmed' AND "previousRegistrationId" IS NOT NULL;
CREATE UNIQUE INDEX "FundAccountBalanceRegistration_one_pending" ON "FundAccountBalanceRegistration"("accountId") WHERE "status" = 'pending_review';
CREATE INDEX "FundAccountBalanceRegistration_accountId_status_idx" ON "FundAccountBalanceRegistration"("accountId", "status");
CREATE TABLE "FundAccountSourceBatch" (
 "id" TEXT PRIMARY KEY, "registrationId" TEXT NOT NULL REFERENCES "FundAccountBalanceRegistration"("id") ON DELETE RESTRICT,
 "lineNo" INTEGER NOT NULL, "amountYuan" DECIMAL(24,4) NOT NULL,
 "sourceStatus" TEXT NOT NULL, "sourceName" TEXT, "projectStatus" TEXT NOT NULL, "projectId" TEXT REFERENCES "Project"("id") ON DELETE RESTRICT,
 "previousSourceBatchId" TEXT REFERENCES "FundAccountSourceBatch"("id") ON DELETE RESTRICT,
 UNIQUE ("registrationId", "lineNo"),
 CHECK ("lineNo" > 0 AND "amountYuan" >= 0 AND "amountYuan" <> 'NaN'::numeric),
 CHECK (("sourceStatus" = 'pending' AND "sourceName" IS NULL) OR ("sourceStatus" = 'known' AND "sourceName" IS NOT NULL AND length(btrim("sourceName")) > 0)),
 CHECK (("projectStatus" IN ('pending', 'company_daily') AND "projectId" IS NULL) OR ("projectStatus" = 'project' AND "projectId" IS NOT NULL))
);
-- Sources are reconciliation snapshots, not fresh receipts, advances or principal.
CREATE FUNCTION "jg_registered_fund_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'registered fund history is append-only'; END IF;
 IF TG_TABLE_NAME <> 'FundAccountBalanceRegistration' THEN RAISE EXCEPTION 'registered fund identity and source snapshots are immutable'; END IF;
 IF OLD."status" <> 'pending_review' OR NEW."status" NOT IN ('confirmed', 'returned', 'withdrawn') OR
    (to_jsonb(NEW) - ARRAY['status','confirmedByUserId','confirmedAt','reviewNote','closedByUserId','closedAt','closeReason']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','confirmedByUserId','confirmedAt','reviewNote','closedByUserId','closedAt','closeReason']) THEN
   RAISE EXCEPTION 'only pending reconciliation confirmation is allowed';
 END IF;
 IF NEW."status" = 'confirmed' AND (NOT EXISTS (SELECT 1 FROM "FundAccountBalanceRegistration" p WHERE p."id" = NEW."previousRegistrationId" AND p."accountId" = NEW."accountId" AND p."status" = 'confirmed') OR
    EXISTS (SELECT 1 FROM "FundAccountBalanceRegistration" p WHERE p."accountId" = NEW."accountId" AND p."status" = 'confirmed' AND p."version" >= NEW."version")) THEN
   RAISE EXCEPTION 'reconciliation predecessor changed';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "RegisteredFundAccount_immutable" BEFORE UPDATE OR DELETE ON "RegisteredFundAccount" FOR EACH ROW EXECUTE FUNCTION "jg_registered_fund_immutable"();
CREATE TRIGGER "FundAccountBalanceRegistration_immutable" BEFORE UPDATE OR DELETE ON "FundAccountBalanceRegistration" FOR EACH ROW EXECUTE FUNCTION "jg_registered_fund_immutable"();
CREATE TRIGGER "FundAccountSourceBatch_immutable" BEFORE UPDATE OR DELETE ON "FundAccountSourceBatch" FOR EACH ROW EXECUTE FUNCTION "jg_registered_fund_immutable"();
CREATE FUNCTION "jg_registered_fund_registration_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."kind" = 'correction' AND (NEW."status" <> 'pending_review' OR NOT EXISTS (
  SELECT 1 FROM "FundAccountBalanceRegistration" p WHERE p."id" = NEW."previousRegistrationId" AND p."accountId" = NEW."accountId" AND p."status" = 'confirmed' AND p."version" < NEW."version" AND p."asOfDate" <= NEW."asOfDate")) THEN
   RAISE EXCEPTION 'correction requires its confirmed same-account predecessor';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FundAccountBalanceRegistration_insert" BEFORE INSERT ON "FundAccountBalanceRegistration" FOR EACH ROW EXECUTE FUNCTION "jg_registered_fund_registration_insert"();
CREATE FUNCTION "jg_registered_fund_source_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "FundAccountBalanceRegistration";
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "FundAccountBalanceRegistration" WHERE "id" = NEW."registrationId" AND xmin::text = (txid_current() % 4294967296)::text) THEN
   RAISE EXCEPTION 'source snapshots must be created atomically with their registration';
 END IF;
 SELECT * INTO STRICT parent FROM "FundAccountBalanceRegistration" WHERE "id" = NEW."registrationId";
 IF (parent."kind" = 'opening' AND NEW."previousSourceBatchId" IS NOT NULL) OR
    (parent."kind" = 'correction' AND (
      (EXISTS (SELECT 1 FROM "FundAccountSourceBatch" WHERE "registrationId" = parent."previousRegistrationId") AND
       NOT EXISTS (SELECT 1 FROM "FundAccountSourceBatch" WHERE "id" = NEW."previousSourceBatchId" AND "registrationId" = parent."previousRegistrationId")) OR
      (NOT EXISTS (SELECT 1 FROM "FundAccountSourceBatch" WHERE "registrationId" = parent."previousRegistrationId") AND NEW."previousSourceBatchId" IS NOT NULL))) THEN
   RAISE EXCEPTION 'source snapshot must retain the previous reconciliation lineage';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FundAccountSourceBatch_lineage" BEFORE INSERT ON "FundAccountSourceBatch" FOR EACH ROW EXECUTE FUNCTION "jg_registered_fund_source_insert"();
CREATE FUNCTION "jg_registered_fund_conservation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid TEXT; amount NUMERIC; total NUMERIC; lines INTEGER;
BEGIN
 IF TG_TABLE_NAME = 'FundAccountBalanceRegistration' THEN rid := NEW."id"; ELSE rid := NEW."registrationId"; END IF;
 SELECT "balanceYuan" INTO amount FROM "FundAccountBalanceRegistration" WHERE "id" = rid;
 SELECT coalesce(sum("amountYuan"), 0), count(*) INTO total, lines FROM "FundAccountSourceBatch" WHERE "registrationId" = rid;
 IF (amount IS NULL AND lines <> 0) OR (amount IS NOT NULL AND amount <> total) THEN
   RAISE EXCEPTION 'registered balance and source snapshots do not conserve';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FundAccountBalanceRegistration_conserve" AFTER INSERT OR UPDATE ON "FundAccountBalanceRegistration" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "jg_registered_fund_conservation"();
CREATE CONSTRAINT TRIGGER "FundAccountSourceBatch_conserve" AFTER INSERT ON "FundAccountSourceBatch" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "jg_registered_fund_conservation"();

-- The namespace is deliberately fund-only: other approval log types retain their rules.
CREATE UNIQUE INDEX "ApprovalActionLog_fund_command_key" ON "ApprovalActionLog" (("metadata"->>'fundReviewCommandKey'))
 WHERE "metadata"->>'fundReviewCommandKind' = 'fund_account_balance_review_v1';
CREATE UNIQUE INDEX "ApprovalActionLog_fund_round_decision" ON "ApprovalActionLog" ("approvalInstanceId")
 WHERE "metadata"->>'fundReviewCommandKind' = 'fund_account_balance_review_v1';
CREATE FUNCTION "jg_fund_command_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."metadata"->>'fundReviewCommandKind' = 'fund_account_balance_review_v1' OR
    (TG_OP = 'UPDATE' AND NEW."metadata"->>'fundReviewCommandKind' = 'fund_account_balance_review_v1') THEN
  RAISE EXCEPTION 'fund command receipts are immutable';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ApprovalActionLog_fund_command_immutable" BEFORE UPDATE OR DELETE ON "ApprovalActionLog"
 FOR EACH ROW EXECUTE FUNCTION "jg_fund_command_immutable"();
-- Deferred to permit the round, registration and action to close in one transaction.
CREATE FUNCTION "jg_fund_review_evidence"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "FundAccountBalanceRegistration"; a "ApprovalInstance"; l "ApprovalActionLog"; expected TEXT;
BEGIN
 SELECT * INTO STRICT r FROM "FundAccountBalanceRegistration" WHERE "id" = NEW."id";
 IF r."kind" <> 'correction' THEN RETURN NULL; END IF;
 SELECT * INTO a FROM "ApprovalInstance" WHERE "id" = r."approvalInstanceId";
 IF a."id" IS NULL OR a."businessType" <> 'fund_account_balance_registration' OR a."flowType" <> 'fund_account_balance_correction' OR a."businessId" <> r."id" OR a."applicantUserId" <> r."createdByUserId" THEN
  RAISE EXCEPTION 'fund reconciliation requires its exact formal review round';
 END IF;
 IF r."status" = 'pending_review' THEN
  IF a."status" <> 'approval_pending' THEN RAISE EXCEPTION 'pending reconciliation round is closed'; END IF;
  RETURN NULL;
 END IF;
 expected := CASE r."status" WHEN 'confirmed' THEN 'approve' WHEN 'returned' THEN 'reject' ELSE 'withdraw' END;
 SELECT * INTO l FROM "ApprovalActionLog" WHERE "approvalInstanceId" = a."id" AND "action" = expected
  AND "metadata"->>'fundReviewCommandKind' = 'fund_account_balance_review_v1';
 IF l."id" IS NULL OR l."actorUserId" IS DISTINCT FROM coalesce(r."confirmedByUserId", r."closedByUserId") OR l."representedUserId" IS NULL OR
  nullif(l."metadata"->>'fundReviewCommandKey', '') IS NULL OR NOT coalesce((l."metadata"->>'fundReviewPayloadFingerprint') ~ '^[a-f0-9]{64}$', false) OR
  l."metadata"->'fundReviewReceipt'->>'id' IS DISTINCT FROM r."id" OR
  l."metadata"->'fundReviewReceipt'->>'approvalInstanceId' IS DISTINCT FROM a."id" OR
  l."metadata"->'fundReviewReceipt'->>'status' IS DISTINCT FROM r."status" OR
  a."status" IS DISTINCT FROM (CASE expected WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'withdrawn' END) THEN
  RAISE EXCEPTION 'fund reconciliation requires atomic frozen action evidence';
 END IF;
 IF expected = 'approve' AND (l."approvedRoleKey" IS DISTINCT FROM 'finance_director' OR l."signatureVersionIdSnapshot" IS NULL OR l."signatureFileIdSnapshot" IS NULL OR l."signatureSha256Snapshot" IS NULL) THEN
  RAISE EXCEPTION 'fund approval requires the actual actor signature snapshot';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FundAccountBalanceRegistration_review_evidence" AFTER INSERT OR UPDATE ON "FundAccountBalanceRegistration"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "jg_fund_review_evidence"();
