BEGIN;

-- Return-to-applicant and withdrawal are existing application revision
-- transitions. Install both database status values only while version writes
-- are quiesced; deployment fails immediately rather than racing a live
-- submit/review/withdraw writer.
DO $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(190731, 16) THEN
    RAISE EXCEPTION
      'spot_procurement_version_status_migration_requires_quiescence'
      USING ERRCODE = '55P03';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    LOCK TABLE "SpotProcurementVersion" IN ACCESS EXCLUSIVE MODE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RAISE EXCEPTION
        'spot_procurement_version_status_migration_requires_quiescence table=SpotProcurementVersion'
        USING ERRCODE = '55P03';
  END;
END;
$$;

-- Replace only the exact constraint shape installed by the retained draft
-- lifecycle migration. A missing, renamed, widened or otherwise drifted
-- status check blocks deployment instead of being silently normalized.
DO $$
DECLARE
  definition TEXT;
  expected_status TEXT;
  literal_count INTEGER;
  normalized_definition TEXT;
  unexpected_literal_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO definition
  FROM pg_constraint
  WHERE conrelid = '"SpotProcurementVersion"'::regclass
    AND conname = 'SpotProcurementVersion_status_check'
    AND contype = 'c';

  IF definition IS NULL
    OR position('CHECK' IN definition) = 0
    OR position('status' IN definition) = 0
    OR position('ANY (ARRAY[' IN definition) = 0
  THEN
    RAISE EXCEPTION
      'unexpected SpotProcurementVersion_status_check definition'
      USING ERRCODE = '23514';
  END IF;

  normalized_definition := regexp_replace(
    replace(definition, '"status"', 'status'),
    '[[:space:]]+',
    '',
    'g'
  );
  IF normalized_definition <>
    'CHECK((status=ANY(ARRAY[''draft''::text,''approval_pending''::text,''rejected''::text,''approved''::text,''invalidated''::text,''abandoned''::text])))NOTVALID'
  THEN
    RAISE EXCEPTION
      'unexpected SpotProcurementVersion_status_check definition'
      USING ERRCODE = '23514';
  END IF;

  unexpected_literal_definition := definition;
  FOREACH expected_status IN ARRAY ARRAY[
    'draft',
    'approval_pending',
    'rejected',
    'approved',
    'invalidated',
    'abandoned'
  ]
  LOOP
    literal_count := (
      length(definition)
      - length(replace(definition, quote_literal(expected_status), ''))
    ) / length(quote_literal(expected_status));
    IF literal_count <> 1 THEN
      RAISE EXCEPTION
        'unexpected SpotProcurementVersion_status_check definition'
        USING ERRCODE = '23514';
    END IF;
    unexpected_literal_definition := replace(
      unexpected_literal_definition,
      quote_literal(expected_status),
      ''
    );
  END LOOP;

  IF unexpected_literal_definition ~ '''[^'']+''' THEN
    RAISE EXCEPTION
      'unexpected SpotProcurementVersion_status_check definition'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- No retained lifecycle value is guessed or rewritten. Unexpected values
-- block deployment before the replacement constraint is installed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SpotProcurementVersion"
    WHERE "status" NOT IN (
      'draft',
      'approval_pending',
      'returned',
      'withdrawn',
      'rejected',
      'approved',
      'invalidated',
      'abandoned'
    )
  ) THEN
    RAISE EXCEPTION 'spot_procurement_version_status_invalid'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE "SpotProcurementVersion"
  ADD CONSTRAINT "SpotProcurementVersion_status_check_next"
  CHECK (
    "status" IN (
      'draft',
      'approval_pending',
      'returned',
      'withdrawn',
      'rejected',
      'approved',
      'invalidated',
      'abandoned'
    )
  ) NOT VALID;

ALTER TABLE "SpotProcurementVersion"
  VALIDATE CONSTRAINT "SpotProcurementVersion_status_check_next";

ALTER TABLE "SpotProcurementVersion"
  DROP CONSTRAINT "SpotProcurementVersion_status_check";

ALTER TABLE "SpotProcurementVersion"
  RENAME CONSTRAINT "SpotProcurementVersion_status_check_next"
  TO "SpotProcurementVersion_status_check";

COMMIT;
