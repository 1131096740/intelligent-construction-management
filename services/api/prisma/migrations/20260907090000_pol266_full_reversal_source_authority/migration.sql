-- POL-12B-R2: persist the controlled approved-source purpose and make a
-- full-reversal source inseparable from its adjacent confirmed authority.
BEGIN;

SELECT pg_advisory_xact_lock(190907, 266);

ALTER TABLE "WageApprovedSourceVersion"
  ADD COLUMN "sourcePurpose" TEXT NOT NULL DEFAULT 'ordinary',
  ADD COLUMN "fullReversalTargetStatementId" TEXT,
  ADD COLUMN "fullReversalPriorVersionId" TEXT,
  ADD COLUMN "fullReversalPriorRevision" INTEGER,
  ADD COLUMN "fullReversalPriorSourceVersionId" TEXT,
  ADD COLUMN "fullReversalRootClosureFingerprint" TEXT;

ALTER TABLE "WageApprovedSourceVersion"
  ALTER COLUMN "sourcePurpose" DROP DEFAULT,
  ADD CONSTRAINT "WageApprovedSourceVersion_source_purpose_check"
    CHECK ("sourcePurpose" IN ('ordinary', 'full_reversal')),
  ADD CONSTRAINT "WageApprovedSourceVersion_full_reversal_binding_check"
    CHECK (
      (
        "sourcePurpose" = 'ordinary'
        AND "fullReversalTargetStatementId" IS NULL
        AND "fullReversalPriorVersionId" IS NULL
        AND "fullReversalPriorRevision" IS NULL
        AND "fullReversalPriorSourceVersionId" IS NULL
        AND "fullReversalRootClosureFingerprint" IS NULL
      ) OR (
        "sourcePurpose" = 'full_reversal'
        AND "fullReversalTargetStatementId" IS NOT NULL
        AND "fullReversalPriorVersionId" IS NOT NULL
        AND "fullReversalPriorRevision" > 0
        AND "fullReversalPriorSourceVersionId" IS NOT NULL
        AND "fullReversalRootClosureFingerprint" ~ '^[0-9a-f]{64}$'
      )
    );

ALTER TABLE "WageApprovedSourceVersion"
  ADD CONSTRAINT "WageApprovedSourceVersion_full_reversal_statement_fkey"
    FOREIGN KEY ("fullReversalTargetStatementId") REFERENCES "WageStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WageApprovedSourceVersion_full_reversal_version_fkey"
    FOREIGN KEY ("fullReversalPriorVersionId") REFERENCES "WageStatementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WageApprovedSourceVersion_full_reversal_prior_source_fkey"
    FOREIGN KEY ("fullReversalPriorSourceVersionId") REFERENCES "WageApprovedSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "WageApprovedSourceVersion_full_reversal_target_idx"
  ON "WageApprovedSourceVersion"("fullReversalTargetStatementId", "fullReversalPriorRevision")
  WHERE "sourcePurpose" = 'full_reversal';

CREATE UNIQUE INDEX "WageStatementVersion_full_reversal_source_once_key"
  ON "WageStatementVersion"("sourceVersionId")
  WHERE "kind" = 'reversal';

CREATE FUNCTION jg_wage_full_reversal_source_use_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_row "WageApprovedSourceVersion"%ROWTYPE;
  prior_row "WageStatementVersion"%ROWTYPE;
BEGIN
  SELECT * INTO source_row
  FROM "WageApprovedSourceVersion"
  WHERE "id" = NEW."sourceVersionId";

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF source_row."sourcePurpose" = 'ordinary' AND NEW."kind" = 'reversal' THEN
    RAISE EXCEPTION 'ordinary approved source cannot be used by reversal'
      USING ERRCODE = '23514';
  END IF;

  IF source_row."sourcePurpose" = 'full_reversal' THEN
    IF NEW."kind" <> 'reversal' THEN
      RAISE EXCEPTION 'full_reversal approved source can only be used by reversal'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO prior_row
    FROM "WageStatementVersion"
    WHERE "id" = source_row."fullReversalPriorVersionId";
    IF NOT FOUND
      OR prior_row."status" <> 'confirmed'
      OR prior_row."statementId" <> source_row."fullReversalTargetStatementId"
      OR prior_row."statementId" <> NEW."statementId"
      OR prior_row."revision" <> source_row."fullReversalPriorRevision"
      OR prior_row."revision" + 1 <> NEW."revision"
      OR prior_row."sourceVersionId" <> source_row."fullReversalPriorSourceVersionId"
    THEN
      RAISE EXCEPTION 'full_reversal approved source target is stale or mismatched'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WageStatementVersion_full_reversal_source_use_guard"
BEFORE INSERT OR UPDATE OF "sourceVersionId", "kind", "statementId", "revision"
ON "WageStatementVersion"
FOR EACH ROW EXECUTE FUNCTION jg_wage_full_reversal_source_use_guard();

COMMIT;
