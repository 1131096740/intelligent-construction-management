-- Publish only the qualified worker's current draft preview pointer in the
-- caller's publication transaction. The archive predicate ACL is unchanged.
BEGIN;

DO $owner$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS version_table
    JOIN pg_catalog.pg_proc AS predicate
      ON predicate.oid = pg_catalog.to_regprocedure('public.jg_upward_archive_constraint_v2(public."ContractVersion")')
    WHERE version_table.oid = 'public."ContractVersion"'::pg_catalog.regclass
      AND version_table.relowner = current_user::pg_catalog.regrole::oid
      AND predicate.proowner = version_table.relowner
  ) THEN
    RAISE EXCEPTION 'CONTRACT_PREVIEW_POINTER_OWNER' USING ERRCODE = '55000';
  END IF;
END
$owner$;

CREATE FUNCTION public.jg_publish_contract_preview_pointer_v1(
  p_version_id text,
  p_draft_revision integer,
  p_content_revision integer,
  p_fingerprint text,
  p_previous_id text,
  p_generation_id text,
  p_source_revision integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $publish$
DECLARE
  locked_contract_id text;
BEGIN
  IF session_user <> 'jg_c259_doc_worker' OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS worker
    WHERE worker.rolname = session_user AND worker.rolcanlogin
      AND NOT (worker.rolsuper OR worker.rolinherit OR worker.rolcreatedb
        OR worker.rolcreaterole OR worker.rolreplication OR worker.rolbypassrls)
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members AS membership
        WHERE worker.oid IN (membership.member, membership.roleid)
      )
  ) THEN
    RAISE EXCEPTION 'CONTRACT_PREVIEW_POINTER_CALLER' USING ERRCODE = '42501';
  END IF;

  IF p_version_id IS NULL OR p_generation_id IS NULL
    OR p_generation_id IS NOT DISTINCT FROM p_previous_id
    OR p_draft_revision IS NULL OR p_content_revision IS NULL OR p_source_revision IS NULL
    OR p_draft_revision < 1 OR p_content_revision < 1
    OR p_source_revision < 1 OR p_source_revision > p_draft_revision
    OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RETURN false;
  END IF;

  -- Use the worker's established contract-then-version lock order.
  SELECT contract."id" INTO locked_contract_id
  FROM public."Contract" AS contract
  JOIN public."ContractVersion" AS version ON version."contractId" = contract."id"
  WHERE version."id" = p_version_id AND contract."voidedAt" IS NULL
  FOR UPDATE OF contract;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM 1 FROM public."ContractVersion" AS version
  WHERE version."id" = p_version_id AND version."contractId" = locked_contract_id
    AND version."status" = 'draft' AND version."endedAt" IS NULL
    AND version."changeType" IS DISTINCT FROM 'historical_takeover'
    AND version."draftRevision" = p_draft_revision
    AND version."documentContentRevision" = p_content_revision
    AND version."documentContentFingerprint" = p_fingerprint
    AND version."latestDraftPreviewDocumentId" IS NOT DISTINCT FROM p_previous_id
  FOR UPDATE OF version;
  IF NOT FOUND THEN RETURN false; END IF;

  IF EXISTS (SELECT 1 FROM public."ContractTakeover" WHERE "contractVersionId" = p_version_id)
    OR EXISTS (SELECT 1 FROM public."ContractFormalFile" WHERE "contractVersionId" = p_version_id AND "purpose" = 'mutually_signed_final' AND "status" = 'active')
    OR EXISTS (SELECT 1 FROM public."ContractSealTask" WHERE "contractVersionId" = p_version_id AND "status" <> 'cancelled')
    OR EXISTS (SELECT 1 FROM public."ContractArchiveFile" WHERE "contractVersionId" = p_version_id)
    OR EXISTS (SELECT 1 FROM public."Settlement" WHERE "contractVersionId" = p_version_id)
    OR EXISTS (SELECT 1 FROM public."PaymentRequest" WHERE "contractVersionId" = p_version_id) THEN
    RETURN false;
  END IF;

  PERFORM 1 FROM public."ContractGeneratedDocument" AS generation
  WHERE generation."id" = p_generation_id AND generation."contractVersionId" = p_version_id
    AND generation."status" = 'success' AND generation."purpose" = 'draft'
    AND generation."sourceRevision" = p_source_revision
    AND generation."inputSnapshot"->'documentContentRevision' = pg_catalog.to_jsonb(p_content_revision)
    AND generation."inputSnapshot"->'documentContentFingerprint' = pg_catalog.to_jsonb(p_fingerprint)
    AND generation."docxFileId" IS NOT NULL AND generation."pdfFileId" IS NOT NULL
    AND generation."docxFileId" <> generation."pdfFileId"
  FOR UPDATE OF generation;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public."ContractVersion"
  SET "latestDraftPreviewDocumentId" = p_generation_id, "updatedAt" = pg_catalog.statement_timestamp()
  WHERE "id" = p_version_id;
  RETURN FOUND;
END
$publish$;

REVOKE ALL ON FUNCTION public.jg_publish_contract_preview_pointer_v1(text, integer, integer, text, text, text, integer) FROM PUBLIC;

COMMIT;
