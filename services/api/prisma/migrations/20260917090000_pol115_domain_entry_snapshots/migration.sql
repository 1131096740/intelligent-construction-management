BEGIN;

CREATE TABLE "ExpenseClaimEntrySnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "expenseClaimId" TEXT NOT NULL REFERENCES "ExpenseClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sceneKey" TEXT NOT NULL,
  "businessAction" TEXT NOT NULL,
  "operationObjectType" TEXT NOT NULL,
  "operationObjectId" TEXT NOT NULL,
  "submissionRevision" TEXT NOT NULL,
  "definitionVersion" INTEGER NOT NULL CHECK ("definitionVersion" > 0),
  "definitionSnapshot" JSONB NOT NULL CHECK (jsonb_typeof("definitionSnapshot") = 'object'),
  "valuesSnapshot" JSONB NOT NULL CHECK (jsonb_typeof("valuesSnapshot") = 'object'),
  "frozenByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpenseClaimEntrySnapshot_reference_check" CHECK (
    length(btrim("sceneKey")) > 0 AND length(btrim("businessAction")) > 0 AND
    length(btrim("operationObjectType")) > 0 AND length(btrim("operationObjectId")) > 0 AND
    length(btrim("submissionRevision")) > 0
  )
);
CREATE UNIQUE INDEX "ExpenseClaimEntrySnapshot_operation_revision_key" ON "ExpenseClaimEntrySnapshot"("expenseClaimId", "sceneKey", "operationObjectType", "operationObjectId", "submissionRevision");
CREATE INDEX "ExpenseClaimEntrySnapshot_expenseClaimId_frozenAt_idx" ON "ExpenseClaimEntrySnapshot"("expenseClaimId", "frozenAt");

CREATE FUNCTION guard_pol115_entry_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'domain_entry_snapshot_immutable';
END;
$$;
CREATE TRIGGER "ExpenseClaimEntrySnapshot_immutable" BEFORE UPDATE OR DELETE ON "ExpenseClaimEntrySnapshot" FOR EACH ROW EXECUTE FUNCTION guard_pol115_entry_snapshot_immutable();
CREATE TRIGGER "ExpenseClaimEntrySnapshot_immutable_truncate" BEFORE TRUNCATE ON "ExpenseClaimEntrySnapshot" FOR EACH STATEMENT EXECUTE FUNCTION guard_pol115_entry_snapshot_immutable();

CREATE TABLE "FundExecutionEntrySnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "fundExecutionCaseId" TEXT NOT NULL REFERENCES "FundExecutionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sceneKey" TEXT NOT NULL CHECK ("sceneKey" = 'fund_execution.case'),
  "businessAction" TEXT NOT NULL CHECK ("businessAction" = 'submit_case'),
  "definitionVersion" INTEGER NOT NULL CHECK ("definitionVersion" > 0),
  "definitionSnapshot" JSONB NOT NULL CHECK (jsonb_typeof("definitionSnapshot") = 'object'),
  "valuesSnapshot" JSONB NOT NULL CHECK (jsonb_typeof("valuesSnapshot") = 'object'),
  "frozenByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "FundExecutionEntrySnapshot_fundExecutionCaseId_key" ON "FundExecutionEntrySnapshot"("fundExecutionCaseId");
CREATE TRIGGER "FundExecutionEntrySnapshot_immutable" BEFORE UPDATE OR DELETE ON "FundExecutionEntrySnapshot" FOR EACH ROW EXECUTE FUNCTION guard_pol115_entry_snapshot_immutable();
CREATE TRIGGER "FundExecutionEntrySnapshot_immutable_truncate" BEFORE TRUNCATE ON "FundExecutionEntrySnapshot" FOR EACH STATEMENT EXECUTE FUNCTION guard_pol115_entry_snapshot_immutable();

COMMIT;
