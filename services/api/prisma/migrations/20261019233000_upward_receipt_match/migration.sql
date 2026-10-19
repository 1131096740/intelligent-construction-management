BEGIN;
CREATE TABLE "UpwardReceiptMatch" (
 "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL REFERENCES "Project"("id"),
 "receiptFactId" TEXT NOT NULL REFERENCES "OperatingFact"("id"),
 "settlementLedgerId" TEXT NOT NULL, "originalId" TEXT REFERENCES "UpwardReceiptMatch"("id"),
 "amountCents" BIGINT NOT NULL CHECK("amountCents">0), "occurredAt" TIMESTAMP(3) NOT NULL,
 "reason" TEXT NOT NULL CHECK(length(btrim("reason"))>0), "frozenSource" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending_confirm' CHECK("status" IN ('pending_confirm','confirmed','returned')),
 "recordedByUserId" TEXT NOT NULL REFERENCES "User"("id"), "confirmedByUserId" TEXT REFERENCES "User"("id"), "confirmedAt" TIMESTAMP(3),
 "confirmationSignatureVersionId" TEXT REFERENCES "HandwrittenSignatureVersion"("id"),
 "idempotencyKey" TEXT NOT NULL UNIQUE, "requestFingerprint" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("status"<>'confirmed' OR ("confirmedByUserId" IS NOT NULL AND "confirmedByUserId"<>"recordedByUserId" AND "confirmedAt" IS NOT NULL AND "confirmationSignatureVersionId" IS NOT NULL))
);
CREATE INDEX "UpwardReceiptMatch_projectId_receiptFactId_status_idx" ON "UpwardReceiptMatch"("projectId","receiptFactId","status");
CREATE INDEX "UpwardReceiptMatch_settlementLedgerId_status_idx" ON "UpwardReceiptMatch"("settlementLedgerId","status");
CREATE FUNCTION guard_upward_receipt_match() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD."status"<>'pending_confirm' THEN RAISE EXCEPTION 'upward_receipt_match_immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','confirmedByUserId','confirmedAt','confirmationSignatureVersionId']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','confirmedByUserId','confirmedAt','confirmationSignatureVersionId']) THEN RAISE EXCEPTION 'upward_receipt_match_source_immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "UpwardReceiptMatch_immutable" BEFORE UPDATE OR DELETE ON "UpwardReceiptMatch" FOR EACH ROW EXECUTE FUNCTION guard_upward_receipt_match();
COMMIT;
