-- Detached upward save source. A subsequent exact installation must attach
-- all three guards and the dual-identity CHECK before supplying the witness.
BEGIN;

CREATE TABLE public.jg_contract_upward_pending_save_binding_v1 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion"=1),
  "applicationRoleOid" OID NOT NULL,
  "databaseOid" OID NOT NULL,
  "namespaceOid" OID NOT NULL,
  "ownerOid" OID NOT NULL,
  "createBindingSha256" TEXT NOT NULL CHECK ("createBindingSha256"~'^[a-f0-9]{64}$'),
  "upwardConstraintSha256" TEXT NOT NULL CHECK ("upwardConstraintSha256"~'^[a-f0-9]{64}$'),
  "subjectConstraintSha256" TEXT NOT NULL CHECK ("subjectConstraintSha256"~'^[a-f0-9]{64}$'),
  "versionRoutineOid" OID NOT NULL,
  "attachmentRoutineOid" OID NOT NULL,
  "slotRoutineOid" OID NOT NULL
);
REVOKE ALL ON TABLE public.jg_contract_upward_pending_save_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_guard_upward_pending_save_binding_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $binding$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION '对上保存绑定不可修改' USING ERRCODE='23514'; END IF;
  IF current_user::regrole::oid IS DISTINCT FROM NEW."ownerOid"
    OR EXISTS(SELECT 1 FROM public.jg_contract_upward_pending_save_binding_v1) THEN
    RAISE EXCEPTION '对上保存只接受可信安装绑定' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$binding$;
REVOKE ALL ON FUNCTION public.jg_guard_upward_pending_save_binding_v1() FROM PUBLIC;
CREATE TRIGGER jg_upward_pending_save_binding_immutable BEFORE INSERT OR UPDATE OR DELETE
ON public.jg_contract_upward_pending_save_binding_v1 FOR EACH ROW EXECUTE FUNCTION public.jg_guard_upward_pending_save_binding_v1();
CREATE TRIGGER jg_upward_pending_save_binding_no_truncate BEFORE TRUNCATE
ON public.jg_contract_upward_pending_save_binding_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_upward_pending_save_binding_v1();

CREATE FUNCTION public.jg_guard_contract_upward_pending_save_v1(
  prior public."ContractVersion", candidate public."ContractVersion"
) RETURNS public."ContractVersion"
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $save_guard$
DECLARE d JSONB:=candidate."draftData"->'directSigningInput'; parent RECORD; verified BOOLEAN;
BEGIN
  SELECT c."id",c."projectId",c."companyEntityId",c."ownerUserId" INTO parent
    FROM public."Contract" c JOIN public."Project" p ON p."id"=c."projectId" AND p."isActive"
    WHERE c."id"=candidate."contractId" AND c."voidedAt" IS NULL AND c."code" IS NULL;
  IF NOT FOUND OR parent."ownerUserId" IS NULL OR parent."companyEntityId" IS DISTINCT FROM candidate."companyEntityIdSnapshot"
    OR prior."id" IS DISTINCT FROM candidate."id" OR prior."contractId" IS DISTINCT FROM candidate."contractId"
    OR prior."draftData"#>>'{directSigningInput,relationship}' IS DISTINCT FROM 'upward'
    OR prior."draftData"#>'{directSigningInput,protocolVersion}' IS DISTINCT FROM '2'::jsonb
    OR prior."draftData"#>>'{directSigningInput,source}' IS DISTINCT FROM 'direct_signed'
    OR prior."status" IS DISTINCT FROM 'draft' OR candidate."status" IS DISTINCT FROM 'draft'
    OR prior."numericProtocolVersion" IS DISTINCT FROM 2 OR candidate."numericProtocolVersion" IS DISTINCT FROM 2
    OR prior."changeType" IS DISTINCT FROM 'original' OR candidate."changeType" IS DISTINCT FROM 'original'
    OR prior."versionNo" IS DISTINCT FROM 1 OR candidate."versionNo" IS DISTINCT FROM 1
    OR candidate."draftRevision" IS DISTINCT FROM prior."draftRevision"+1
    OR candidate."signingSubjectType" IS DISTINCT FROM 'upward'
    OR candidate."firstSubmittedAt" IS NOT NULL OR candidate."effectiveAt" IS NOT NULL OR candidate."endedAt" IS NOT NULL
    OR candidate."baseVersionId" IS NOT NULL OR candidate."supersedesVersionId" IS NOT NULL OR candidate."copiedFromContractVersionId" IS NOT NULL
    OR candidate."documentContentFingerprint" IS NOT NULL OR candidate."latestDraftPreviewDocumentId" IS NOT NULL
    OR candidate."businessTemplateVersionId" IS NOT NULL OR candidate."layoutTemplateVersionId" IS NOT NULL
    OR candidate."taxFactsFrozenAt" IS NOT NULL OR candidate."originalSignedNumber"='' OR candidate."amountCents" IS DISTINCT FROM 0
    OR candidate."draftData"#>>'{contractBasics,relationship}' IS DISTINCT FROM 'upward'
    OR d->'protocolVersion' IS DISTINCT FROM '2'::jsonb OR d->>'relationship' IS DISTINCT FROM 'upward'
    OR d->>'source' IS DISTINCT FROM 'direct_signed'
    OR NOT ((d->'enterpriseParty'='{"roleKey":"party_a","displayOrder":0}' AND d->'companyParty'='{"roleKey":"party_b","displayOrder":0}')
      OR (d->'enterpriseParty'='{"roleKey":"party_b","displayOrder":0}' AND d->'companyParty'='{"roleKey":"party_a","displayOrder":0}'))
    OR EXISTS(SELECT 1 FROM public."ContractArchiveFile" a WHERE a."contractVersionId"=candidate."id") THEN
    RAISE EXCEPTION '对上保存只允许当前原始未归档草稿' USING ERRCODE='23514';
  END IF;
  -- The save authority is installed only with the complete pending-read
  -- proof. Child rows are written before this transition, but no title,
  -- identity or file change may commit if that proof cannot be read.
  SELECT count(*)=1 INTO verified FROM public.jg_contract_upward_pending_save_binding_v1 b
    WHERE b."protocolVersion"=1 AND b."applicationRoleOid"=current_user::regrole::oid
      AND b."applicationRoleOid"=session_user::regrole::oid;
  IF NOT verified THEN RAISE EXCEPTION '对上保存安装绑定未供应' USING ERRCODE='55000'; END IF;
  RETURN candidate;
END;
$save_guard$;
REVOKE ALL ON FUNCTION public.jg_guard_contract_upward_pending_save_v1(public."ContractVersion",public."ContractVersion") FROM PUBLIC;
-- This source is detached too. The eventual AFTER UPDATE trigger must be
-- present in the same profile as the three dispatcher bodies.
CREATE FUNCTION public.jg_check_contract_upward_pending_save_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $post_save$
DECLARE owner_id TEXT;
BEGIN
  IF NEW."draftData"#>>'{directSigningInput,relationship}' IS DISTINCT FROM 'upward' THEN RETURN NEW; END IF;
  SELECT c."ownerUserId" INTO owner_id FROM public."Contract" c WHERE c."id"=NEW."contractId";
  IF owner_id IS NULL OR public.jg_contract_upward_pending_read_v1(NEW."id",owner_id) IS NULL THEN
    RAISE EXCEPTION '对上保存未形成当前双方和原件的持久证明' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$post_save$;
REVOKE ALL ON FUNCTION public.jg_check_contract_upward_pending_save_v1() FROM PUBLIC;
COMMIT;
