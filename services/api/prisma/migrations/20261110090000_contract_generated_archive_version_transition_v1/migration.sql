-- The original generated archive, its fixed originals, and a prior completed seal
-- authorize one pending-to-effective transition. Application archive writes stay gated.
BEGIN;
SET LOCAL search_path TO pg_catalog,public;

LOCK TABLE public."ContractVersion",public."ApprovalInstance",public."ContractSealTask",
  public."ContractArchiveFile" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.jg_contract_generated_upward_seal_binding_v1 IN SHARE MODE;

CREATE TABLE public.jg_contract_generated_archive_version_transition_v1 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion"=1),
  "sealBindingOid" OID NOT NULL,
  "sealBindingSha256" TEXT NOT NULL CHECK ("sealBindingSha256"~'^[a-f0-9]{64}$'),
  "upwardConstraintOid" OID NOT NULL,
  "upwardConstraintSha256" TEXT NOT NULL CHECK ("upwardConstraintSha256"~'^[a-f0-9]{64}$')
);
REVOKE ALL ON TABLE public.jg_contract_generated_archive_version_transition_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_guard_generated_archive_version_transition_binding_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $binding$
BEGIN
  IF TG_OP<>'INSERT' OR current_user IS DISTINCT FROM session_user
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=TG_RELID AND c.relowner=current_user::regrole::oid)
    OR EXISTS(SELECT 1 FROM public.jg_contract_generated_archive_version_transition_v1) THEN
    RAISE EXCEPTION '生成合同归档生效绑定只接受一次可信安装' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$binding$;
REVOKE ALL ON FUNCTION public.jg_guard_generated_archive_version_transition_binding_v1() FROM PUBLIC;
CREATE TRIGGER jg_generated_archive_version_transition_binding_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.jg_contract_generated_archive_version_transition_v1
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_generated_archive_version_transition_binding_v1();
CREATE TRIGGER jg_generated_archive_version_transition_binding_no_truncate
BEFORE TRUNCATE ON public.jg_contract_generated_archive_version_transition_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_generated_archive_version_transition_binding_v1();

DO $install$
DECLARE
  seal RECORD;
  original_guard RECORD;
  successor_constraint RECORD;
  before_predicate TEXT;
  next_body TEXT;
  app_name NAME;
  owner_id OID:=current_user::regrole::oid;
  binding_table OID:='public.jg_contract_generated_archive_version_transition_v1'::regclass;
  seal_table OID:='public.jg_contract_generated_upward_seal_binding_v1'::regclass;
  version_table OID:='public."ContractVersion"'::regclass;
  archive_basis OID:=pg_catalog.to_regprocedure('public.jg_generated_archive_activation_basis_v1(pg_catalog.text,pg_catalog.bool)');
  declarations TEXT:=$declarations$  node JSONB;
$declarations$;
  prior_frozen_block TEXT:=$prior$  IF TG_OP<>'INSERT' AND OLD."signingSubjectType"='upward' AND OLD."status"=awaiting_archive THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION '对上待归档版本不可删除' USING ERRCODE='23514'; END IF;
    IF (to_jsonb(NEW)-'updatedAt') IS DISTINCT FROM (to_jsonb(OLD)-'updatedAt') THEN
      RAISE EXCEPTION '对上待归档版本不可修改' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
$prior$;
  transition_block TEXT:=$transition$
  IF TG_OP<>'INSERT' THEN
    was_external:=OLD."signingSubjectType"='upward' OR COALESCE(
      OLD."numericProtocolVersion"=2 AND OLD."signingSubjectType"='affiliate'
      AND OLD."firstSubmittedAt" IS NOT NULL AND NOT (OLD."draftData"?'directSigningInput')
      AND OLD."readinessSnapshot"#>>'{signingIdentity,relationship}'='outside',FALSE);
  END IF;
  IF TG_OP<>'DELETE' THEN
    is_external:=NEW."signingSubjectType"='upward' OR COALESCE(
      NEW."numericProtocolVersion"=2 AND NEW."signingSubjectType"='affiliate'
      AND NEW."firstSubmittedAt" IS NOT NULL AND NOT (NEW."draftData"?'directSigningInput')
      AND NEW."readinessSnapshot"#>>'{signingIdentity,relationship}'='outside',FALSE);
  END IF;

  IF was_external AND OLD."status" IN (awaiting_archive,'effective') THEN
    IF TG_OP='DELETE' THEN
      RAISE EXCEPTION '生成合同已盖章版本不可删除' USING ERRCODE='23514';
    END IF;
    IF OLD."status"='effective' OR NEW."status" IS DISTINCT FROM 'effective' THEN
      IF (to_jsonb(NEW)-'updatedAt') IS DISTINCT FROM (to_jsonb(OLD)-'updatedAt') THEN
        RAISE EXCEPTION '生成合同已盖章版本不可修改' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;

    IF NOT is_external OR OLD."effectiveAt" IS NOT NULL OR NEW."effectiveAt" IS NULL
      OR NEW."taxFactsFrozenAt" IS DISTINCT FROM NEW."effectiveAt"
      OR (to_jsonb(NEW)-ARRAY['status','effectiveAt','taxFactsFrozenAt','updatedAt'])
         IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','effectiveAt','taxFactsFrozenAt','updatedAt']) THEN
      RAISE EXCEPTION '生成合同只可沿本轮待归档版本生效' USING ERRCODE='23514';
    END IF;

    SELECT a."id",a."confirmedAt" INTO archive_row
      FROM public."ContractArchiveFile" a
      JOIN public."ContractSealTask" s ON s."id"=a."sealTaskId" AND s."contractVersionId"=OLD."id"
        AND s."approvalInstanceId"=a."approvalInstanceId" AND s."status"='completed'
        AND s.xmin::text<>mod(pg_catalog.txid_current(),4294967296::bigint)::text
      WHERE a."contractVersionId"=OLD."id" AND a."archiveProtocolVersion"=2 AND a."archiveSource"='generated_approval'
        AND a.xmin::text=mod(pg_catalog.txid_current(),4294967296::bigint)::text;
    IF NOT FOUND OR archive_row."confirmedAt" IS DISTINCT FROM NEW."effectiveAt" THEN
      RAISE EXCEPTION '生成合同生效缺少本轮已完成盖章和同事务归档' USING ERRCODE='23514';
    END IF;
    PERFORM public.jg_generated_archive_activation_basis_v1(archive_row."id",FALSE);
    RETURN NEW;
  END IF;

  IF TG_OP<>'DELETE' AND is_external AND NEW."status"='effective' THEN
    RAISE EXCEPTION '生成合同必须由本轮待归档状态生效' USING ERRCODE='23514';
  END IF;
$transition$;
  round_pending TEXT:=$round$AND v."signingSubjectType"='upward' AND v."status"=awaiting_archive FOR SHARE$round$;
  round_archived TEXT:=$round_next$AND v."status" IN (awaiting_archive,'effective')
        AND (v."signingSubjectType"='upward' OR (v."signingSubjectType"='affiliate' AND v."numericProtocolVersion"=2
          AND v."firstSubmittedAt" IS NOT NULL AND NOT (v."draftData"?'directSigningInput')
          AND v."readinessSnapshot"#>>'{signingIdentity,relationship}'='outside')) FOR SHARE$round_next$;
  prior_completed_task TEXT:=$task_old$WHERE v."id"=OLD."contractVersionId"
        AND v."signingSubjectType"='upward' AND v."numericProtocolVersion"=2 AND v."firstSubmittedAt" IS NOT NULL FOR SHARE$task_old$;
  frozen_completed_task TEXT:=$task_next$WHERE v."id"=OLD."contractVersionId" AND v."numericProtocolVersion"=2 AND v."firstSubmittedAt" IS NOT NULL
        AND (v."signingSubjectType"='upward' OR (v."signingSubjectType"='affiliate' AND v."status" IN (awaiting_archive,'effective')
          AND NOT (v."draftData"?'directSigningInput')
          AND v."readinessSnapshot"#>>'{signingIdentity,relationship}'='outside')) FOR SHARE$task_next$;
  effective_predicate TEXT:=$effective$
    COALESCE(
      "signingSubjectType"='upward' AND "numericProtocolVersion"=2 AND "versionNo"=1 AND "changeType"='original'
      AND "effectiveAt" IS NOT NULL AND "taxFactsFrozenAt" IS NOT NULL AND "taxFactsFrozenAt"="effectiveAt" AND "firstSubmittedAt" IS NOT NULL AND "endedAt" IS NULL
      AND "baseVersionId" IS NULL AND "supersedesVersionId" IS NULL AND "copiedFromContractVersionId" IS NULL
      AND "originalSignedNumber" IS NULL
      AND jsonb_typeof("draftData")='object' AND NOT ("draftData"?'directSigningInput')
      AND "draftData"#>>'{contractBasics,relationship}'='upward'
      AND NULLIF(btrim("companyEntityIdSnapshot"),'') IS NOT NULL
      AND NULLIF(btrim("companyEntityVersionId"),'') IS NOT NULL
      AND NULLIF(btrim("companyEntityNameSnapshot"),'') IS NOT NULL
      AND NULLIF(btrim("companyEntityCreditCodeSnapshot"),'') IS NOT NULL
      AND NULLIF(btrim("affiliateAssignmentId"),'') IS NOT NULL
      AND NULLIF(btrim("affiliateBusinessPartyVersionId"),'') IS NOT NULL
      AND NULLIF(btrim("affiliateNameSnapshot"),'') IS NOT NULL
      AND ("affiliateCreditCodeSnapshot" IS NULL OR
        upper(btrim("affiliateCreditCodeSnapshot"))<>upper(btrim("companyEntityCreditCodeSnapshot")))
      AND "status"='effective'
      AND "draftRevision">0 AND "documentContentRevision">0 AND "layoutTemplateVersionId" IS NOT NULL
      AND "documentContentFingerprint"~'^[a-f0-9]{64}$'
      AND "readinessSnapshot"->'submissionProtocolVersion'='2'::jsonb
      AND "readinessSnapshot"->>'contractVersionId'="id"
      AND "readinessSnapshot"->'draftRevision'=to_jsonb("draftRevision")
      AND "readinessSnapshot"->'documentContentRevision'=to_jsonb("documentContentRevision")
      AND "readinessSnapshot"->>'documentContentFingerprint'="documentContentFingerprint"
      AND "readinessSnapshot"->>'layoutTemplateVersionId'="layoutTemplateVersionId"
      AND "readinessSnapshot"->>'sourceSha256'~'^[a-f0-9]{64}$'
      AND NULLIF(btrim("readinessSnapshot"->>'generatedDocumentId'),'') IS NOT NULL
      AND "readinessSnapshot"->'blanksReviewed'='true'::jsonb
      AND "readinessSnapshot"#>'{signingIdentity,protocolVersion}'='1'::jsonb
      AND "readinessSnapshot"#>>'{signingIdentity,relationship}'='upward'
      AND "readinessSnapshot"#>>'{signingIdentity,roleSource}'='document_company_selection_party_a_and_assignment_party_b'
      AND "readinessSnapshot"#>>'{signingIdentity,company,domain}'='company_entity_version'
      AND "readinessSnapshot"#>>'{signingIdentity,company,id}'="companyEntityVersionId"
      AND "readinessSnapshot"#>>'{signingIdentity,company,companyEntityId}'="companyEntityIdSnapshot"
      AND "readinessSnapshot"#>>'{signingIdentity,company,roleKey}'='party_a'
      AND "readinessSnapshot"#>'{signingIdentity,company,displayOrder}'='0'::jsonb
      AND NULLIF(btrim("readinessSnapshot"#>>'{signingIdentity,company,projectParticipatingCompanyId}'),'') IS NOT NULL
      AND NULLIF(btrim("readinessSnapshot"#>>'{signingIdentity,company,joinedCompanyEntityVersionId}'),'') IS NOT NULL
      AND "readinessSnapshot"#>>'{signingIdentity,enterprise,domain}'='project_affiliate_assignment'
      AND "readinessSnapshot"#>>'{signingIdentity,enterprise,assignmentId}'="affiliateAssignmentId"
      AND "readinessSnapshot"#>>'{signingIdentity,enterprise,businessPartyVersionId}'="affiliateBusinessPartyVersionId"
      AND "readinessSnapshot"#>>'{signingIdentity,enterprise,roleKey}'='party_b'
      AND "readinessSnapshot"#>'{signingIdentity,enterprise,displayOrder}'='0'::jsonb
      AND NULLIF(btrim("readinessSnapshot"#>>'{signingIdentity,enterprise,businessPartyId}'),'') IS NOT NULL
      AND NULLIF(btrim("readinessSnapshot"#>>'{signingIdentity,enterprise,partySnapshotId}'),'') IS NOT NULL
    ,FALSE)
$effective$;
BEGIN
  SELECT b.* INTO STRICT seal FROM public.jg_contract_generated_upward_seal_binding_v1 b
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public');
  SELECT rolname INTO STRICT app_name FROM pg_catalog.pg_roles WHERE oid=seal."applicationRoleOid";
  IF current_user IS DISTINCT FROM session_user OR owner_id IS DISTINCT FROM seal."ownerOid"
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(seal."applicationRoleOid",r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR pg_catalog.pg_has_role(r.oid,owner_id,'MEMBER')
        OR pg_catalog.has_schema_privilege(r.oid,seal."namespaceOid",'CREATE')))
    OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN (binding_table,seal_table,version_table)
      AND c.relowner=owner_id AND c.relnamespace=seal."namespaceOid" AND c.relkind='r'
      AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)<>3
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=archive_basis
      AND p.proowner=owner_id AND p.pronamespace=seal."namespaceOid" AND NOT p.prosecdef
      AND p.prorettype='pg_catalog.date'::regtype AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND pg_catalog.has_function_privilege(seal."applicationRoleOid",p.oid,'EXECUTE')
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='7d231034f736945ec01332f494a33dba7e816eb54aefaae56d13a149c62a2f56') THEN
    RAISE EXCEPTION '生成合同归档生效角色或原生效依据不匹配' USING ERRCODE='55000';
  END IF;

  SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT original_guard FROM pg_catalog.pg_proc p
    WHERE p.oid=seal."guardOid" AND p.oid=pg_catalog.to_regprocedure('public.jg_guard_generated_upward_seal_completion_v1()')
      AND p.proowner=owner_id AND p.pronamespace=seal."namespaceOid" AND NOT p.prosecdef
      AND p.prorettype='pg_catalog.trigger'::regtype AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='835ff5e902400a816b886d194a7078709a0aad01208d67f4b8f2b080108e84d6';
  IF (SELECT count(*) FROM (VALUES
      (seal."versionTriggerOid",version_table,'jg_generated_upward_seal_version',31,FALSE),
      (seal."roundTriggerOid",'public."ApprovalInstance"'::regclass::oid,'jg_generated_upward_seal_round',31,FALSE),
      (seal."taskTriggerOid",'public."ContractSealTask"'::regclass::oid,'jg_generated_upward_seal_task',31,FALSE),
      (seal."completionTriggerOid",'public."ContractSealTask"'::regclass::oid,'jg_generated_upward_seal_task_complete',17,TRUE)
    ) wanted(oid,relation,name,kind,deferred)
    JOIN pg_catalog.pg_trigger t ON t.oid=wanted.oid AND t.tgrelid=wanted.relation AND t.tgname=wanted.name
      AND t.tgtype=wanted.kind AND t.tgfoid=original_guard.oid AND t.tgenabled='O' AND NOT t.tgisinternal
      AND t.tgdeferrable=wanted.deferred AND t.tginitdeferred=wanted.deferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='')<>4
    OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgfoid=original_guard.oid)<>4 THEN
    RAISE EXCEPTION '原对上盖章任务的接线已变化' USING ERRCODE='55000';
  END IF;
  SELECT pg_catalog.pg_get_expr(c.conbin,c.conrelid,false) INTO STRICT before_predicate
    FROM pg_catalog.pg_constraint c WHERE c.oid=seal."upwardConstraintOid"
      AND c.conrelid=version_table AND c.contype='c' AND c.convalidated AND c.conislocal
      AND c.conname='ContractVersion_upward_draft_source_check'
      AND encode(public.digest(convert_to(pg_catalog.pg_get_constraintdef(c.oid,false),'UTF8'),'sha256'),'hex')=seal."upwardConstraintSha256";

  next_body:=replace(original_guard.prosrc,declarations,
    declarations||E'  was_external BOOLEAN:=FALSE;\n  is_external BOOLEAN:=FALSE;\n  archive_row RECORD;\n');
  next_body:=replace(next_body,prior_frozen_block,transition_block);
  next_body:=replace(next_body,round_pending,round_archived);
  next_body:=replace(next_body,prior_completed_task,frozen_completed_task);
  IF encode(public.digest(convert_to(next_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM 'ae9d017bf6f9fd6617e7a58a3908c64c76c0130b0c49aa73a316d34ffbb44449' THEN
    RAISE EXCEPTION '生成合同归档生效守卫接线后态不匹配' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(pg_catalog.pg_get_functiondef(original_guard.oid),original_guard.prosrc,next_body);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=original_guard.oid AND p.prosrc=next_body
    AND to_jsonb(p)-'prosrc'=original_guard.metadata) THEN
    RAISE EXCEPTION '生成合同归档生效改变了原盖章守卫身份' USING ERRCODE='55000';
  END IF;

  ALTER TABLE public."ContractVersion" DROP CONSTRAINT "ContractVersion_upward_draft_source_check";
  EXECUTE format('ALTER TABLE public."ContractVersion" ADD CONSTRAINT "ContractVersion_upward_draft_source_check" CHECK ((%s) OR (%s))',
    before_predicate,effective_predicate);
  SELECT c.oid,encode(public.digest(convert_to(pg_catalog.pg_get_constraintdef(c.oid,false),'UTF8'),'sha256'),'hex') AS digest
    INTO STRICT successor_constraint FROM pg_catalog.pg_constraint c WHERE c.conrelid=version_table
      AND c.contype='c' AND c.convalidated AND c.conislocal AND c.conname='ContractVersion_upward_draft_source_check';
  IF successor_constraint.oid=seal."upwardConstraintOid" OR successor_constraint.digest=seal."upwardConstraintSha256" THEN
    RAISE EXCEPTION '生成合同归档生效新状态约束未安装' USING ERRCODE='55000';
  END IF;

  EXECUTE format('GRANT SELECT ON TABLE public.jg_contract_generated_archive_version_transition_v1 TO %I',app_name);
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
    WHERE c.oid=binding_table AND a.grantee=seal."applicationRoleOid" AND a.grantor=owner_id
      AND a.privilege_type='SELECT' AND NOT a.is_grantable)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid=binding_table AND (a.grantor<>owner_id OR a.grantee<>owner_id
        AND (a.grantee<>seal."applicationRoleOid" OR a.privilege_type<>'SELECT' OR a.is_grantable)))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=binding_table
      AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.oid=pg_catalog.to_regprocedure('public.jg_guard_generated_archive_version_transition_binding_v1()')
        AND (a.grantee<>owner_id OR a.grantor<>owner_id)) THEN
    RAISE EXCEPTION '生成合同归档生效记录权限超出限定范围' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.jg_contract_generated_archive_version_transition_v1(
    "protocolVersion","sealBindingOid","sealBindingSha256","upwardConstraintOid","upwardConstraintSha256")
  VALUES(1,seal_table,encode(public.digest(convert_to(to_jsonb(seal)::text,'UTF8'),'sha256'),'hex'),
    successor_constraint.oid,successor_constraint.digest);
END;
$install$;

COMMIT;
