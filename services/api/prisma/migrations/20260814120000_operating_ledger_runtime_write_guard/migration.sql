CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "OperatingLedgerFactWritePayload" AS (
  "id" TEXT,
  "projectId" TEXT,
  "sourceType" TEXT,
  "sourceBusinessId" TEXT,
  "sourceVersion" INTEGER,
  "sourceBusinessCode" TEXT,
  "occurredAt" TIMESTAMPTZ,
  "confirmedAt" TIMESTAMPTZ,
  "affiliateAssignmentId" TEXT,
  "affiliateBusinessPartyVersionId" TEXT,
  "affiliateNameSnapshot" TEXT,
  "affiliateCreditCodeSnapshot" TEXT,
  "operatingLedgerEffectiveDateSnapshot" DATE,
  "isBeforeOperatingLedgerEffectiveDate" BOOLEAN,
  "historicalTakeoverBatchId" TEXT,
  "factKind" TEXT,
  "operatingLevel" TEXT,
  "evidenceLevel" TEXT,
  "amountCents" BIGINT,
  "currencyCode" TEXT,
  "direction" TEXT,
  "debtorSubjectKind" TEXT,
  "debtorSubjectId" TEXT,
  "creditorSubjectKind" TEXT,
  "creditorSubjectId" TEXT,
  "approvedPayerSubjectKind" TEXT,
  "approvedPayerSubjectId" TEXT,
  "actualPayerSubjectKind" TEXT,
  "actualPayerSubjectId" TEXT,
  "payeeSubjectKind" TEXT,
  "payeeSubjectId" TEXT,
  "costBearingCompanySubjectKind" TEXT,
  "costBearingCompanySubjectId" TEXT,
  "subjectSnapshot" JSONB,
  "sourceSnapshot" JSONB,
  "basisSnapshot" JSONB,
  "entryKind" TEXT,
  "adjustsFactId" TEXT,
  "idempotencyKey" TEXT,
  "confirmedByUserId" TEXT,
  "status" TEXT
);

CREATE TYPE "OperatingLedgerImpactWritePayload" AS (
  "id" TEXT,
  "factId" TEXT,
  "projectId" TEXT,
  "sourceType" TEXT,
  "sourceBusinessId" TEXT,
  "sourceImpactKey" TEXT,
  "idempotencyKey" TEXT,
  "impactKind" TEXT,
  "amountCents" BIGINT,
  "direction" TEXT,
  "subjectRole" TEXT,
  "subjectKind" TEXT,
  "subjectId" TEXT,
  "costCategoryCode" TEXT,
  "fundPurpose" TEXT,
  "description" TEXT,
  "impactSnapshot" JSONB
);

CREATE TABLE "OperatingLedgerWriteSecret" (
  "id" SMALLINT NOT NULL,
  "secretHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatingLedgerWriteSecret_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperatingLedgerWriteSecret_singleton_check" CHECK ("id" = 1)
);

CREATE TABLE "OperatingLedgerWriteContext" (
  "backendPid" INTEGER NOT NULL,
  "transactionId" BIGINT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatingLedgerWriteContext_pkey" PRIMARY KEY ("backendPid", "transactionId")
);

CREATE INDEX "OperatingLedgerWriteContext_createdAt_idx"
  ON "OperatingLedgerWriteContext"("createdAt");

REVOKE ALL ON TABLE "OperatingLedgerWriteSecret" FROM PUBLIC;
REVOKE ALL ON TABLE "OperatingLedgerWriteContext" FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "OperatingFact" FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "OperatingImpactEntry" FROM PUBLIC;

CREATE OR REPLACE FUNCTION "authorizeOperatingLedgerWrite"(
  p_actor_user_id TEXT,
  p_secret TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  stored_secret_hash TEXT;
BEGIN
  SELECT "secretHash"
    INTO stored_secret_hash
    FROM public."OperatingLedgerWriteSecret"
    WHERE "id" = 1;

  IF p_actor_user_id IS NULL
     OR btrim(p_actor_user_id) = ''
     OR stored_secret_hash IS NULL
     OR p_secret IS NULL
     OR public.crypt(p_secret, stored_secret_hash) <> stored_secret_hash THEN
    RAISE EXCEPTION '经营账写入授权上下文无效' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."OperatingLedgerWriteContext"
   WHERE "createdAt" < CURRENT_TIMESTAMP - INTERVAL '1 day';

  INSERT INTO public."OperatingLedgerWriteContext"(
    "backendPid",
    "transactionId",
    "actorUserId"
  )
  VALUES (pg_backend_pid(), txid_current(), p_actor_user_id)
  ON CONFLICT ("backendPid", "transactionId") DO UPDATE
    SET "actorUserId" = EXCLUDED."actorUserId",
        "createdAt" = CURRENT_TIMESTAMP;
END;
$$;

CREATE OR REPLACE FUNCTION "assertOperatingLedgerWriteContext"(
  p_actor_user_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  authorized_actor_user_id TEXT;
BEGIN
  SELECT "actorUserId"
    INTO authorized_actor_user_id
    FROM public."OperatingLedgerWriteContext"
    WHERE "backendPid" = pg_backend_pid()
      AND "transactionId" = txid_current();

  IF authorized_actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION '正式经营账必须通过受控写入函数登记' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "appendOperatingFactThroughService"(
  p_payload "OperatingLedgerFactWritePayload",
  p_actor_user_id TEXT,
  p_secret TEXT
)
RETURNS TABLE(
  "id" TEXT,
  "projectId" TEXT,
  "sourceType" TEXT,
  "sourceBusinessId" TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public."authorizeOperatingLedgerWrite"(p_actor_user_id, p_secret);
  PERFORM set_config('app.operating_ledger_actor', p_actor_user_id, true);

  RETURN QUERY
  INSERT INTO public."OperatingFact"(
    "id",
    "projectId",
    "sourceType",
    "sourceBusinessId",
    "sourceVersion",
    "sourceBusinessCode",
    "occurredAt",
    "confirmedAt",
    "affiliateAssignmentId",
    "affiliateBusinessPartyVersionId",
    "affiliateNameSnapshot",
    "affiliateCreditCodeSnapshot",
    "operatingLedgerEffectiveDateSnapshot",
    "isBeforeOperatingLedgerEffectiveDate",
    "historicalTakeoverBatchId",
    "factKind",
    "operatingLevel",
    "evidenceLevel",
    "amountCents",
    "currencyCode",
    "direction",
    "debtorSubjectKind",
    "debtorSubjectId",
    "creditorSubjectKind",
    "creditorSubjectId",
    "approvedPayerSubjectKind",
    "approvedPayerSubjectId",
    "actualPayerSubjectKind",
    "actualPayerSubjectId",
    "payeeSubjectKind",
    "payeeSubjectId",
    "costBearingCompanySubjectKind",
    "costBearingCompanySubjectId",
    "subjectSnapshot",
    "sourceSnapshot",
    "basisSnapshot",
    "entryKind",
    "adjustsFactId",
    "idempotencyKey",
    "recordedByUserId",
    "confirmedByUserId",
    "status"
  )
  VALUES(
    COALESCE(NULLIF(p_payload."id", ''), public.gen_random_uuid()::TEXT),
    p_payload."projectId",
    p_payload."sourceType",
    p_payload."sourceBusinessId",
    p_payload."sourceVersion",
    p_payload."sourceBusinessCode",
    p_payload."occurredAt" AT TIME ZONE 'UTC',
    p_payload."confirmedAt" AT TIME ZONE 'UTC',
    p_payload."affiliateAssignmentId",
    p_payload."affiliateBusinessPartyVersionId",
    p_payload."affiliateNameSnapshot",
    p_payload."affiliateCreditCodeSnapshot",
    p_payload."operatingLedgerEffectiveDateSnapshot",
    p_payload."isBeforeOperatingLedgerEffectiveDate",
    p_payload."historicalTakeoverBatchId",
    p_payload."factKind",
    p_payload."operatingLevel",
    p_payload."evidenceLevel",
    p_payload."amountCents",
    COALESCE(NULLIF(p_payload."currencyCode", ''), 'CNY'),
    p_payload."direction",
    p_payload."debtorSubjectKind",
    p_payload."debtorSubjectId",
    p_payload."creditorSubjectKind",
    p_payload."creditorSubjectId",
    p_payload."approvedPayerSubjectKind",
    p_payload."approvedPayerSubjectId",
    p_payload."actualPayerSubjectKind",
    p_payload."actualPayerSubjectId",
    p_payload."payeeSubjectKind",
    p_payload."payeeSubjectId",
    p_payload."costBearingCompanySubjectKind",
    p_payload."costBearingCompanySubjectId",
    p_payload."subjectSnapshot",
    p_payload."sourceSnapshot",
    p_payload."basisSnapshot",
    COALESCE(NULLIF(p_payload."entryKind", ''), 'original'),
    p_payload."adjustsFactId",
    p_payload."idempotencyKey",
    p_actor_user_id,
    p_payload."confirmedByUserId",
    COALESCE(NULLIF(p_payload."status", ''), 'confirmed')
  )
  RETURNING "OperatingFact"."id",
            "OperatingFact"."projectId",
            "OperatingFact"."sourceType",
            "OperatingFact"."sourceBusinessId";
END;
$$;

CREATE OR REPLACE FUNCTION "appendOperatingImpactThroughService"(
  p_payload "OperatingLedgerImpactWritePayload",
  p_actor_user_id TEXT,
  p_secret TEXT
)
RETURNS TABLE("id" TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public."authorizeOperatingLedgerWrite"(p_actor_user_id, p_secret);
  PERFORM set_config('app.operating_ledger_actor', p_actor_user_id, true);

  RETURN QUERY
  INSERT INTO public."OperatingImpactEntry"(
    "id",
    "factId",
    "projectId",
    "sourceType",
    "sourceBusinessId",
    "sourceImpactKey",
    "idempotencyKey",
    "impactKind",
    "amountCents",
    "direction",
    "subjectRole",
    "subjectKind",
    "subjectId",
    "costCategoryCode",
    "fundPurpose",
    "description",
    "impactSnapshot"
  )
  VALUES(
    COALESCE(NULLIF(p_payload."id", ''), public.gen_random_uuid()::TEXT),
    p_payload."factId",
    p_payload."projectId",
    p_payload."sourceType",
    p_payload."sourceBusinessId",
    p_payload."sourceImpactKey",
    p_payload."idempotencyKey",
    p_payload."impactKind",
    p_payload."amountCents",
    p_payload."direction",
    p_payload."subjectRole",
    p_payload."subjectKind",
    p_payload."subjectId",
    p_payload."costCategoryCode",
    p_payload."fundPurpose",
    p_payload."description",
    p_payload."impactSnapshot"
  )
  RETURNING "OperatingImpactEntry"."id";
END;
$$;

CREATE OR REPLACE FUNCTION "requireOperatingLedgerWriteContextForFact"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public."assertOperatingLedgerWriteContext"(NEW."recordedByUserId");
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "requireOperatingLedgerWriteContextForImpact"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  fact_recorded_by_user_id TEXT;
BEGIN
  SELECT "recordedByUserId"
    INTO fact_recorded_by_user_id
    FROM public."OperatingFact"
    WHERE "id" = NEW."factId"
      AND "projectId" = NEW."projectId";
  PERFORM public."assertOperatingLedgerWriteContext"(fact_recorded_by_user_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OperatingFact_require_write_context"
  BEFORE INSERT ON "OperatingFact"
  FOR EACH ROW EXECUTE FUNCTION "requireOperatingLedgerWriteContextForFact"();

CREATE TRIGGER "OperatingImpactEntry_require_write_context"
  BEFORE INSERT ON "OperatingImpactEntry"
  FOR EACH ROW EXECUTE FUNCTION "requireOperatingLedgerWriteContextForImpact"();

REVOKE ALL ON FUNCTION "authorizeOperatingLedgerWrite"(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "assertOperatingLedgerWriteContext"(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "appendOperatingFactThroughService"("OperatingLedgerFactWritePayload", TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "appendOperatingImpactThroughService"("OperatingLedgerImpactWritePayload", TEXT, TEXT) FROM PUBLIC;
