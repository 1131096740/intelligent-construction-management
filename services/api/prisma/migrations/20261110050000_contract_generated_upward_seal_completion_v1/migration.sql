-- Only the sealed, awaiting-archive state is added. Archive activation needs a separate authority.
BEGIN;
SET LOCAL search_path TO pg_catalog, public;

LOCK TABLE public."ContractVersion", public."ApprovalInstance", public."ContractSealTask" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.jg_contract_generated_upward_submission_binding_v1 IN SHARE MODE;

CREATE TABLE public.jg_contract_generated_upward_seal_binding_v1 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion"=1),
  "applicationRoleOid" OID NOT NULL,
  "databaseOid" OID NOT NULL,
  "namespaceOid" OID NOT NULL,
  "ownerOid" OID NOT NULL,
  "predecessorOid" OID NOT NULL,
  "predecessorSha256" TEXT NOT NULL CHECK ("predecessorSha256"~'^[a-f0-9]{64}$'),
  "upwardConstraintOid" OID NOT NULL,
  "upwardConstraintSha256" TEXT NOT NULL CHECK ("upwardConstraintSha256"~'^[a-f0-9]{64}$'),
  "guardOid" OID NOT NULL,
  "versionTriggerOid" OID NOT NULL,
  "roundTriggerOid" OID NOT NULL,
  "taskTriggerOid" OID NOT NULL,
  "completionTriggerOid" OID NOT NULL
);
REVOKE ALL ON TABLE public.jg_contract_generated_upward_seal_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_guard_generated_upward_seal_binding_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $binding$
BEGIN
  IF TG_OP<>'INSERT' OR current_user::regrole::oid IS DISTINCT FROM NEW."ownerOid"
    OR session_user::regrole::oid IS DISTINCT FROM NEW."ownerOid"
    OR EXISTS(SELECT 1 FROM public.jg_contract_generated_upward_seal_binding_v1) THEN
    RAISE EXCEPTION '对上盖章完成绑定只接受一次可信安装' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$binding$;
REVOKE ALL ON FUNCTION public.jg_guard_generated_upward_seal_binding_v1() FROM PUBLIC;
CREATE TRIGGER jg_generated_upward_seal_binding_immutable BEFORE INSERT OR UPDATE OR DELETE
ON public.jg_contract_generated_upward_seal_binding_v1 FOR EACH ROW EXECUTE FUNCTION public.jg_guard_generated_upward_seal_binding_v1();
CREATE TRIGGER jg_generated_upward_seal_binding_no_truncate BEFORE TRUNCATE
ON public.jg_contract_generated_upward_seal_binding_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_generated_upward_seal_binding_v1();

CREATE FUNCTION public.jg_guard_generated_upward_seal_completion_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $guard$
DECLARE
  awaiting_archive CONSTANT TEXT := 'seal_approved_pending_archive';
  parent_version RECORD;
  approved_round RECORD;
  seal_task RECORD;
  contract RECORD;
  version_id TEXT;
  actor_roles TEXT[];
  node JSONB;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' THEN
    RAISE EXCEPTION '对上盖章完成守卫作用域错误' USING ERRCODE='55000';
  END IF;

  IF TG_TABLE_NAME='ApprovalInstance' THEN
    IF TG_OP<>'INSERT' AND OLD."businessType"='contract_version'
      AND OLD."flowType"='contract.approve' AND OLD."status"='approved' THEN
      PERFORM 1 FROM public."ContractVersion" v WHERE v."id"=OLD."businessId"
        AND v."signingSubjectType"='upward' AND v."status"=awaiting_archive FOR SHARE;
      IF FOUND THEN RAISE EXCEPTION '对上待归档轮次不可修改' USING ERRCODE='23514'; END IF;
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    IF NEW."businessType"='contract_version' AND NEW."flowType"='contract.approve'
      AND NEW."status" IN ('in_progress','approved') THEN
      PERFORM 1 FROM public."ContractVersion" v WHERE v."id"=NEW."businessId"
        AND v."signingSubjectType"='upward' AND v."status"=awaiting_archive FOR SHARE;
      IF FOUND THEN RAISE EXCEPTION '对上待归档版本不可新增办理轮次' USING ERRCODE='23514'; END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='ContractSealTask' THEN
    IF TG_WHEN='AFTER' THEN
      IF NEW."status"='completed' AND OLD."status"<>'completed' THEN
        SELECT v."status" INTO parent_version FROM public."ContractVersion" v WHERE v."id"=NEW."contractVersionId"
          AND v."signingSubjectType"='upward' AND v."numericProtocolVersion"=2 AND v."firstSubmittedAt" IS NOT NULL FOR SHARE;
        IF FOUND AND parent_version."status"<>awaiting_archive THEN
          RAISE EXCEPTION '对上盖章完成须在同一事务进入待归档' USING ERRCODE='23514';
        END IF;
      END IF;
      RETURN NEW;
    END IF;
    IF TG_OP<>'INSERT' AND OLD."status"='completed' THEN
      SELECT v."status" INTO parent_version FROM public."ContractVersion" v WHERE v."id"=OLD."contractVersionId"
        AND v."signingSubjectType"='upward' AND v."numericProtocolVersion"=2 AND v."firstSubmittedAt" IS NOT NULL FOR SHARE;
      IF FOUND THEN RAISE EXCEPTION '对上已完成盖章任务不可修改' USING ERRCODE='23514'; END IF;
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    IF NEW."status"<>'completed' THEN RETURN NEW; END IF;
    SELECT v."status" INTO parent_version FROM public."ContractVersion" v WHERE v."id"=NEW."contractVersionId"
      AND v."signingSubjectType"='upward' AND v."numericProtocolVersion"=2 AND v."firstSubmittedAt" IS NOT NULL FOR SHARE;
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION '对上盖章任务必须由本轮待办完成' USING ERRCODE='23514'; END IF;
    IF parent_version."status"<>'approved_pending_seal' OR OLD."status"<>'in_seal'
      OR OLD."completedAt" IS NOT NULL OR OLD."completedByUserId" IS NOT NULL
      OR (to_jsonb(NEW)-ARRAY['status','completedAt','completedByUserId','updatedAt'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','completedAt','completedByUserId','updatedAt']) THEN
      RAISE EXCEPTION '对上盖章任务必须沿本轮待办完成' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME<>'ContractVersion' THEN
    RAISE EXCEPTION '对上盖章完成守卫作用域错误' USING ERRCODE='55000';
  END IF;
  IF TG_OP<>'INSERT' AND OLD."signingSubjectType"='upward' AND OLD."status"=awaiting_archive THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION '对上待归档版本不可删除' USING ERRCODE='23514'; END IF;
    IF (to_jsonb(NEW)-'updatedAt') IS DISTINCT FROM (to_jsonb(OLD)-'updatedAt') THEN
      RAISE EXCEPTION '对上待归档版本不可修改' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP<>'INSERT' AND OLD."signingSubjectType"='upward' AND OLD."status"='approved_pending_seal'
    AND EXISTS (SELECT 1 FROM public."ContractSealTask" t WHERE t."contractVersionId"=OLD."id" AND t."status"='completed') THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION '对上已完成盖章的版本不可删除' USING ERRCODE='23514'; END IF;
    IF NEW."status"<>awaiting_archive OR NEW."signingSubjectType"<>'upward' THEN
      RAISE EXCEPTION '对上已完成盖章的版本须沿本轮进入待归档' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW."signingSubjectType"<>'upward' OR NEW."status"<>awaiting_archive THEN RETURN NEW; END IF;
  IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION '对上待归档版本必须由本轮盖章推进' USING ERRCODE='23514'; END IF;
  IF OLD."status"<>'approved_pending_seal' OR OLD."signingSubjectType"<>'upward'
    OR (to_jsonb(NEW)-ARRAY['status','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updatedAt'])
    OR NOT EXISTS (
      SELECT 1 FROM public.jg_contract_generated_upward_seal_binding_v1 b
      JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
      WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public')
        AND b."applicationRoleOid"=current_user::regrole::oid AND b."applicationRoleOid"=session_user::regrole::oid
    ) THEN
    RAISE EXCEPTION '对上待归档版本缺少本轮盖章或应用资格' USING ERRCODE='23514';
  END IF;

  version_id:=NEW."id";
  SELECT c."id",c."ownerUserId",c."code",c."voidedAt",c."companyEntityId",c."projectId",p."isActive" INTO contract
    FROM public."Contract" c JOIN public."Project" p ON p."id"=c."projectId"
    WHERE c."id"=NEW."contractId" FOR SHARE OF c,p;
  SELECT t.*,t.xmin::text AS task_xid INTO seal_task
    FROM public."ContractSealTask" t WHERE t."contractVersionId"=version_id AND t."status"<>'cancelled'
    FOR SHARE;
  IF NOT FOUND OR seal_task."status"<>'completed' OR seal_task."approvedAt" IS NULL
    OR seal_task."approvedByUserId" IS NULL OR seal_task."completedAt" IS NULL
    OR seal_task."completedByUserId" IS NULL OR seal_task."completedAt"<seal_task."approvedAt"
    OR seal_task.task_xid<>mod(pg_catalog.txid_current(),4294967296::bigint)::text
    OR contract."id" IS NULL OR contract."ownerUserId" IS NULL OR contract."voidedAt" IS NOT NULL
    OR contract."isActive" IS DISTINCT FROM TRUE OR contract."companyEntityId" IS DISTINCT FROM NEW."companyEntityIdSnapshot"
    OR seal_task."handlerUserId" IS DISTINCT FROM contract."ownerUserId" THEN
    RAISE EXCEPTION '对上归档待办缺少同事务完成的原经办盖章任务' USING ERRCODE='23514';
  END IF;

  SELECT r.* INTO approved_round FROM public."ApprovalInstance" r WHERE r."id"=seal_task."approvalInstanceId" FOR SHARE;
  IF NOT FOUND OR approved_round."businessType"<>'contract_version' OR approved_round."flowType"<>'contract.approve'
    OR approved_round."status"<>'approved' OR approved_round."businessId" IS DISTINCT FROM version_id
    OR approved_round."applicantUserId" IS DISTINCT FROM seal_task."handlerUserId"
    OR jsonb_typeof(approved_round."frozenNodes") IS DISTINCT FROM 'array'
    OR approved_round."frozenNodes"->0->'submissionSnapshot' IS DISTINCT FROM NEW."readinessSnapshot"
    OR NEW."readinessSnapshot"->>'formalCode' IS DISTINCT FROM contract."code"
    OR NEW."readinessSnapshot"->>'applicantUserId' IS DISTINCT FROM contract."ownerUserId"
    OR NEW."readinessSnapshot"#>>'{versionFacts,contractId}' IS DISTINCT FROM contract."id"
    OR NEW."readinessSnapshot"#>>'{versionFacts,signingSubjectType}' IS DISTINCT FROM 'upward'
    OR EXISTS (SELECT 1 FROM public."ApprovalInstance" other
      WHERE other."businessType"='contract_version' AND other."flowType"='contract.approve'
        AND other."businessId"=version_id AND other."id"<>approved_round."id"
        AND other."status" IN ('in_progress','approved')) THEN
    RAISE EXCEPTION '对上盖章任务与本轮冻结来源不一致' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(approved_round."frozenNodes")=0
    OR approved_round."currentNodeIndex"<>jsonb_array_length(approved_round."frozenNodes")
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(approved_round."frozenNodes") WITH ORDINALITY a(value,n)
      WHERE a.n>1 AND a.value?'submissionSnapshot') THEN
    RAISE EXCEPTION '对上盖章任务缺少唯一完成的审批轮次' USING ERRCODE='23514';
  END IF;
  FOR node IN SELECT value FROM jsonb_array_elements(approved_round."frozenNodes")
  LOOP
    IF jsonb_typeof(node) IS DISTINCT FROM 'object' OR node->'protocolVersion' IS DISTINCT FROM '1'::jsonb
      OR node->>'executionMode' IS DISTINCT FROM 'parallel' OR node->>'mode' IS NULL OR node->>'mode' NOT IN ('all','any')
      OR jsonb_typeof(node->'roleKeys') IS DISTINCT FROM 'array'
      OR jsonb_typeof(node->'approvedRoleKeys') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION '对上审批职责格式不完整' USING ERRCODE='23514';
    END IF;
    IF jsonb_array_length(node->'roleKeys')=0
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(node->'roleKeys') e(value) WHERE jsonb_typeof(e.value)<>'string')
      OR (CASE WHEN node->>'mode'='all' THEN NOT (node->'approvedRoleKeys' @> node->'roleKeys')
        ELSE NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(node->'roleKeys') r(key) WHERE (node->'approvedRoleKeys')?r.key) END) THEN
      RAISE EXCEPTION '对上审批职责尚未全部完成' USING ERRCODE='23514';
    END IF;
  END LOOP;

  SELECT array_agg(k.role_key) INTO actor_roles FROM (
    SELECT p."key" AS role_key FROM public."UserPosition" up
    JOIN public."Position" p ON p."id"=up."positionId"
    JOIN public."User" u ON u."id"=up."userId"
    WHERE up."projectId" IS NULL AND up."userId"=seal_task."completedByUserId" AND u."isActive"
      AND p."key" IN ('comprehensive_director','super_admin') FOR SHARE OF up,p,u
  ) k;
  IF NOT COALESCE('comprehensive_director'=ANY(actor_roles),FALSE) OR COALESCE('super_admin'=ANY(actor_roles),FALSE) THEN
    RAISE EXCEPTION '对上盖章确认人缺少当前综合主管资格' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.jg_guard_generated_upward_seal_completion_v1() FROM PUBLIC;
CREATE TRIGGER jg_generated_upward_seal_version BEFORE INSERT OR UPDATE OR DELETE ON public."ContractVersion"
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_generated_upward_seal_completion_v1();
CREATE TRIGGER jg_generated_upward_seal_round BEFORE INSERT OR UPDATE OR DELETE ON public."ApprovalInstance"
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_generated_upward_seal_completion_v1();
CREATE TRIGGER jg_generated_upward_seal_task BEFORE INSERT OR UPDATE OR DELETE ON public."ContractSealTask"
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_generated_upward_seal_completion_v1();
CREATE CONSTRAINT TRIGGER jg_generated_upward_seal_task_complete
AFTER UPDATE ON public."ContractSealTask" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_generated_upward_seal_completion_v1();

DO $install_seal_completion$
DECLARE
  owner_id OID:=current_user::regrole::oid;
  app_name NAME;
  db OID;
  ns OID:=pg_catalog.to_regnamespace('public');
  predecessor_table OID:='public.jg_contract_generated_upward_submission_binding_v1'::regclass;
  binding_table OID:='public.jg_contract_generated_upward_seal_binding_v1'::regclass;
  version_table OID:='public."ContractVersion"'::regclass;
  predecessor_guard OID:=pg_catalog.to_regprocedure('public.jg_guard_generated_upward_submission_binding_v1()');
  guard OID:=pg_catalog.to_regprocedure('public.jg_guard_generated_upward_seal_completion_v1()');
  before_binding RECORD;
  before_predicate TEXT;
  new_constraint RECORD;
  sealed_predicate TEXT := $sealed$
    COALESCE(
      "signingSubjectType"='upward' AND "numericProtocolVersion"=2 AND "versionNo"=1 AND "changeType"='original'
      AND "effectiveAt" IS NULL AND "firstSubmittedAt" IS NOT NULL AND "endedAt" IS NULL
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
      AND "status"='seal_approved_pending_archive'
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
$sealed$;
BEGIN
  SELECT oid INTO STRICT db FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database();
  SELECT p.* INTO STRICT before_binding FROM public.jg_contract_generated_upward_submission_binding_v1 p WHERE p."protocolVersion"=1;
  SELECT rolname INTO STRICT app_name FROM pg_catalog.pg_roles WHERE oid=before_binding."applicationRoleOid";
  IF owner_id IS DISTINCT FROM session_user::regrole::oid OR owner_id=before_binding."applicationRoleOid"
    OR before_binding."ownerOid" IS DISTINCT FROM owner_id OR before_binding."databaseOid" IS DISTINCT FROM db
    OR before_binding."namespaceOid" IS DISTINCT FROM ns OR NOT before_binding."sealHandoffEnabled"
    OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN (predecessor_table,binding_table,version_table)
      AND c.relowner=owner_id AND c.relnamespace=ns AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)<>3
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid=predecessor_table AND a.grantee=before_binding."applicationRoleOid" AND a.grantor=owner_id
        AND a.privilege_type='SELECT' AND NOT a.is_grantable)
    OR NOT EXISTS (SELECT 1 FROM public.jg_contract_upward_pending_save_binding_v1 q
      WHERE q.tableoid=before_binding."predecessorOid" AND q."protocolVersion"=1
        AND q."ownerOid"=owner_id AND q."databaseOid"=db AND q."namespaceOid"=ns
        AND q."applicationRoleOid"=before_binding."applicationRoleOid"
        AND encode(public.digest(convert_to(to_jsonb(q)::text,'UTF8'),'sha256'),'hex')=before_binding."predecessorSha256"
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.oid=before_binding."subjectConstraintOid"
          AND c.conrelid=version_table AND c.contype='c' AND c.convalidated AND c.conislocal
          AND c.conname='ContractVersion_signing_subject_check'
          AND encode(public.digest(convert_to(pg_catalog.pg_get_constraintdef(c.oid,false),'UTF8'),'sha256'),'hex')=q."subjectConstraintSha256"))
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE p.oid=predecessor_guard AND p.proowner=owner_id AND p.pronamespace=ns AND NOT p.prosecdef
        AND p.provolatile='v' AND l.lanname='plpgsql' AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='08c0c90d9c755152e26fb05d6a1e343fbd6d9c415f2722ff96c395b00452130e')
    OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=predecessor_table AND t.tgfoid=predecessor_guard
      AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
      AND ((t.tgname='jg_generated_upward_submission_binding_immutable' AND t.tgtype=31)
        OR (t.tgname='jg_generated_upward_submission_binding_no_truncate' AND t.tgtype=34)))<>2
    OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=predecessor_table)<>2 THEN
    RAISE EXCEPTION '原对上生成提交资格不可核对' USING ERRCODE='55000';
  END IF;
  SELECT pg_catalog.pg_get_expr(c.conbin,c.conrelid,false) INTO STRICT before_predicate
    FROM pg_catalog.pg_constraint c WHERE c.oid=before_binding."upwardConstraintOid"
      AND c.conrelid=version_table AND c.contype='c' AND c.convalidated AND c.conislocal
      AND c.conname='ContractVersion_upward_draft_source_check'
      AND encode(public.digest(convert_to(pg_catalog.pg_get_constraintdef(c.oid,false),'UTF8'),'sha256'),'hex')=before_binding."upwardConstraintSha256";

  IF EXISTS (SELECT 1 FROM public."ContractSealTask" t JOIN public."ContractVersion" v ON v."id"=t."contractVersionId"
    WHERE t."status"='completed' AND v."signingSubjectType"='upward'
      AND v."numericProtocolVersion"=2 AND v."firstSubmittedAt" IS NOT NULL) THEN
    RAISE EXCEPTION '旧对上盖章完成记录须先核对，不能直接安装' USING ERRCODE='55000';
  END IF;

  ALTER TABLE public."ContractVersion" DROP CONSTRAINT "ContractVersion_upward_draft_source_check";
  EXECUTE format('ALTER TABLE public."ContractVersion" ADD CONSTRAINT "ContractVersion_upward_draft_source_check" CHECK ((%s) OR (%s))',
    before_predicate,sealed_predicate);
  SELECT c.oid,encode(public.digest(convert_to(pg_catalog.pg_get_constraintdef(c.oid,false),'UTF8'),'sha256'),'hex') AS digest
    INTO STRICT new_constraint FROM pg_catalog.pg_constraint c WHERE c.conrelid=version_table
      AND c.contype='c' AND c.convalidated AND c.conislocal AND c.conname='ContractVersion_upward_draft_source_check';

  EXECUTE format('GRANT SELECT ON TABLE public.jg_contract_generated_upward_seal_binding_v1 TO %I',app_name);
  IF new_constraint.oid=before_binding."upwardConstraintOid" OR new_constraint.digest=before_binding."upwardConstraintSha256"
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid=binding_table AND a.grantee=before_binding."applicationRoleOid" AND a.grantor=owner_id
        AND a.privilege_type='SELECT' AND NOT a.is_grantable)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid IN (predecessor_table,binding_table) AND (a.grantor<>owner_id OR a.grantee<>owner_id AND
        (a.grantee<>before_binding."applicationRoleOid" OR a.privilege_type<>'SELECT' OR a.is_grantable)))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid IN (predecessor_table,binding_table)
      AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(before_binding."applicationRoleOid",r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR pg_catalog.pg_has_role(r.oid,owner_id,'MEMBER')
        OR pg_catalog.has_schema_privilege(r.oid,ns,'CREATE')
        OR pg_catalog.has_table_privilege(r.oid,predecessor_table,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR pg_catalog.has_table_privilege(r.oid,binding_table,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid IN (guard,pg_catalog.to_regprocedure('public.jg_guard_generated_upward_seal_binding_v1()'))
        AND (a.grantee<>owner_id OR a.grantor<>owner_id)) THEN
    RAISE EXCEPTION '对上盖章完成安装权限不匹配' USING ERRCODE='55000';
  END IF;
  INSERT INTO public.jg_contract_generated_upward_seal_binding_v1(
    "protocolVersion","applicationRoleOid","databaseOid","namespaceOid","ownerOid","predecessorOid","predecessorSha256",
    "upwardConstraintOid","upwardConstraintSha256","guardOid","versionTriggerOid","roundTriggerOid","taskTriggerOid","completionTriggerOid")
  VALUES(1,before_binding."applicationRoleOid",db,ns,owner_id,predecessor_table,
    encode(public.digest(convert_to(to_jsonb(before_binding)::text,'UTF8'),'sha256'),'hex'),
    new_constraint.oid,new_constraint.digest,guard,
    (SELECT oid FROM pg_catalog.pg_trigger WHERE tgrelid=version_table AND tgname='jg_generated_upward_seal_version'),
    (SELECT oid FROM pg_catalog.pg_trigger WHERE tgrelid='public."ApprovalInstance"'::regclass AND tgname='jg_generated_upward_seal_round'),
    (SELECT oid FROM pg_catalog.pg_trigger WHERE tgrelid='public."ContractSealTask"'::regclass AND tgname='jg_generated_upward_seal_task'),
    (SELECT oid FROM pg_catalog.pg_trigger WHERE tgrelid='public."ContractSealTask"'::regclass AND tgname='jg_generated_upward_seal_task_complete'));
END;
$install_seal_completion$;

COMMIT;
