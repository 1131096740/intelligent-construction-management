-- PREPARED ONLY: task 20 source artifact. Execution requires separate migration authorization.
BEGIN;
ALTER TABLE "GeneralProcurement"
  ADD COLUMN "requestProtocolVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'project',
  ADD COLUMN "lines" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "estimatedAmount" NUMERIC(24,4),
  ALTER COLUMN "projectId" DROP NOT NULL,
  ALTER COLUMN "companyEntityId" DROP NOT NULL,
  ALTER COLUMN "companyNameSnapshot" DROP NOT NULL,
  ALTER COLUMN "requestedAmountCents" DROP NOT NULL;
ALTER TABLE "GeneralProcurement"
  DROP CONSTRAINT "GeneralProcurement_amount_check",
  DROP CONSTRAINT "GeneralProcurement_status_check",
  DROP CONSTRAINT "GeneralProcurement_category_check";
CREATE FUNCTION jg_general_request_lines_valid(lines JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE WHEN jsonb_typeof(lines) <> 'array' THEN FALSE
    WHEN jsonb_array_length(lines) NOT BETWEEN 1 AND 500 THEN FALSE
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(lines) line
      WHERE jsonb_typeof(line) <> 'object'
        OR jsonb_typeof(line->'id') IS DISTINCT FROM 'string'
        OR COALESCE(line->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR jsonb_typeof(line->'name') IS DISTINCT FROM 'string'
        OR length(btrim(COALESCE(line->>'name',''))) NOT BETWEEN 1 AND 500
        OR EXISTS (SELECT 1 FROM jsonb_each(line) field WHERE field.key NOT IN ('id','name','specification','unit','quantity','unitPrice','estimatedAmount','requiredOn','note'))
        OR EXISTS (SELECT 1 FROM unnest(ARRAY['specification','unit','quantity','unitPrice','estimatedAmount','requiredOn','note']) key
          WHERE NOT line ? key OR jsonb_typeof(line->key) NOT IN ('string','null'))
        OR (line->>'quantity' IS NOT NULL AND line->>'quantity' !~ '^(0|[1-9][0-9]{0,17})(\.[0-9]{1,4})?$')
        OR (line->>'unitPrice' IS NOT NULL AND line->>'unitPrice' !~ '^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$')
        OR (line->>'estimatedAmount' IS NOT NULL AND line->>'estimatedAmount' !~ '^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$')
    ) AND (SELECT count(DISTINCT line->>'id') = jsonb_array_length(lines) FROM jsonb_array_elements(lines) line)
  END;
$$;
ALTER TABLE "GeneralProcurement"
  ADD CONSTRAINT "GeneralProcurement_request_protocol_check" CHECK (
    ("requestProtocolVersion" = 1 AND "scope" = 'project' AND "projectId" IS NOT NULL
      AND "companyEntityId" IS NOT NULL AND "companyNameSnapshot" IS NOT NULL AND "requestedAmountCents" > 0
      AND "requestedAmountCents" IS NOT NULL AND "estimatedAmount" IS NULL
      AND "category" IN ('office_supplies','construction_tools','gifts','logistics','meals','utilities','other')
      AND "status" IN ('draft','approval_pending','returned','approved_pending_archive','archived'))
    OR ("requestProtocolVersion" = 2 AND (("scope" = 'project' AND "projectId" IS NOT NULL) OR ("scope" = 'company_daily' AND "projectId" IS NULL))
      AND (("companyEntityId" IS NULL AND "companyNameSnapshot" IS NULL) OR ("companyEntityId" IS NOT NULL AND "companyNameSnapshot" IS NOT NULL))
      AND "requestedAmountCents" IS NULL AND ("estimatedAmount" IS NULL OR "estimatedAmount" >= 0)
      AND "status" IN ('draft','approval_pending','returned','approved_pending_procurement')
      AND jg_general_request_lines_valid("lines"))
  ),
  ADD CONSTRAINT "GeneralProcurement_category_check" CHECK ("category" IN ('office_supplies','construction_tools','equipment','software','services','gifts','logistics','meals','utilities','other'));
CREATE FUNCTION jg_guard_general_request_protocol() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."requestProtocolVersion" <> OLD."requestProtocolVersion" THEN
    RAISE EXCEPTION 'procurement request protocol is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."requestProtocolVersion" = 2 AND OLD."status" NOT IN ('draft','returned') AND
    (NEW."scope",NEW."projectId",NEW."companyEntityId",NEW."companyNameSnapshot",NEW."category",NEW."reason",NEW."requestedAmountCents",NEW."estimatedAmount",NEW."lines") IS DISTINCT FROM
    (OLD."scope",OLD."projectId",OLD."companyEntityId",OLD."companyNameSnapshot",OLD."category",OLD."reason",OLD."requestedAmountCents",OLD."estimatedAmount",OLD."lines") THEN
    RAISE EXCEPTION 'submitted request content is frozen' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "GeneralProcurement_request_protocol_guard" BEFORE UPDATE ON "GeneralProcurement"
FOR EACH ROW EXECUTE FUNCTION jg_guard_general_request_protocol();
COMMIT;
