-- Source-only successor to the installed upward direct-save profile.
BEGIN;
SET LOCAL search_path TO pg_catalog, public;

CREATE TABLE public.jg_contract_generated_upward_submission_binding_v1 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion"=1),
  "applicationRoleOid" OID NOT NULL,
  "databaseOid" OID NOT NULL,
  "namespaceOid" OID NOT NULL,
  "ownerOid" OID NOT NULL,
  "predecessorOid" OID NOT NULL,
  "predecessorSha256" TEXT NOT NULL CHECK ("predecessorSha256"~'^[a-f0-9]{64}$'),
  "subjectConstraintOid" OID NOT NULL,
  "upwardConstraintOid" OID NOT NULL,
  "upwardConstraintSha256" TEXT NOT NULL CHECK ("upwardConstraintSha256"~'^[a-f0-9]{64}$'),
  "sealHandoffEnabled" BOOLEAN NOT NULL CHECK ("sealHandoffEnabled")
);
REVOKE ALL ON TABLE public.jg_contract_generated_upward_submission_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_guard_generated_upward_submission_binding_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $binding$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION '对上生成提交绑定不可修改' USING ERRCODE='23514'; END IF;
  IF current_user::regrole::oid IS DISTINCT FROM NEW."ownerOid"
    OR session_user::regrole::oid IS DISTINCT FROM NEW."ownerOid"
    OR EXISTS(SELECT 1 FROM public.jg_contract_generated_upward_submission_binding_v1) THEN
    RAISE EXCEPTION '对上生成提交只接受可信安装绑定' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$binding$;
REVOKE ALL ON FUNCTION public.jg_guard_generated_upward_submission_binding_v1() FROM PUBLIC;
CREATE TRIGGER jg_generated_upward_submission_binding_immutable BEFORE INSERT OR UPDATE OR DELETE
ON public.jg_contract_generated_upward_submission_binding_v1 FOR EACH ROW EXECUTE FUNCTION public.jg_guard_generated_upward_submission_binding_v1();
CREATE TRIGGER jg_generated_upward_submission_binding_no_truncate BEFORE TRUNCATE
ON public.jg_contract_generated_upward_submission_binding_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_generated_upward_submission_binding_v1();

DO $install_generated_upward$
DECLARE
  owner_id OID:=current_user::regrole::oid;
  app OID;
  app_name NAME;
  db OID;
  ns OID:=pg_catalog.to_regnamespace('public');
  version_table OID:='public."ContractVersion"'::regclass;
  previous_table OID:='public.jg_contract_upward_pending_save_binding_v1'::regclass;
  successor_table OID:='public.jg_contract_generated_upward_submission_binding_v1'::regclass;
  old_binding_guard OID:=pg_catalog.to_regprocedure('public.jg_guard_upward_pending_save_binding_v1()');
  previous RECORD;
  prior_subject OID;
  prior_upward TEXT;
  expected_upward TEXT;
  new_upward OID;
  new_upward_sha TEXT;
  generated_predicate TEXT := $generated$
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
      AND (
        -- Withdrawal, rejection and subsequent editing retain the native
        -- parties and first submission time. The old round owns its snapshot.
        "status"='draft' OR (
          "status" IN ('in_approval','approved_pending_seal')
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
        )
      ),FALSE)
$generated$;
BEGIN
  LOCK TABLE public."ContractVersion" IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.jg_contract_upward_pending_save_binding_v1 IN SHARE MODE;
  SELECT oid INTO STRICT db FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database();
  SELECT b.* INTO STRICT previous FROM public.jg_contract_upward_pending_save_binding_v1 b WHERE b."protocolVersion"=1;
  app:=previous."applicationRoleOid";
  SELECT rolname INTO STRICT app_name FROM pg_catalog.pg_roles WHERE oid=app;
  IF owner_id IS DISTINCT FROM session_user::regrole::oid OR owner_id=app
    OR previous."ownerOid" IS DISTINCT FROM owner_id OR previous."databaseOid" IS DISTINCT FROM db
    OR previous."namespaceOid" IS DISTINCT FROM ns
    OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN (previous_table,version_table,successor_table)
      AND c.relowner=owner_id AND c.relnamespace=ns AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)<>3
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(app,r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR pg_catalog.pg_has_role(r.oid,owner_id,'MEMBER')
        OR pg_catalog.has_schema_privilege(r.oid,ns,'CREATE')
        OR pg_catalog.has_table_privilege(r.oid,previous_table,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid=previous_table AND a.grantee=app AND a.grantor=owner_id AND a.privilege_type='SELECT' AND NOT a.is_grantable)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid=previous_table AND (a.grantor<>owner_id OR a.grantee<>owner_id AND
        (a.grantee<>app OR a.privilege_type<>'SELECT' OR a.is_grantable)))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=previous_table
      AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=old_binding_guard AND p.proowner=owner_id
      AND p.pronamespace=ns AND NOT p.prosecdef AND p.provolatile='v'
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='637c42531d6e58ba08d3d5ec497ccd82874cbe0d713d0e249d794a3694755028')
    OR (SELECT count(*) FROM pg_catalog.pg_trigger h WHERE h.tgrelid=previous_table AND h.tgfoid=old_binding_guard
      AND h.tgenabled='O' AND NOT h.tgisinternal AND NOT h.tgdeferrable AND NOT h.tginitdeferred
      AND h.tgqual IS NULL AND h.tgnargs=0 AND h.tgattr::text=''
      AND ((h.tgname='jg_upward_pending_save_binding_immutable' AND h.tgtype=31)
        OR (h.tgname='jg_upward_pending_save_binding_no_truncate' AND h.tgtype=34)))<>2
    OR (SELECT count(*) FROM pg_catalog.pg_trigger h WHERE h.tgrelid=previous_table)<>2 THEN
    RAISE EXCEPTION '原对上直签安装身份、绑定或权限已变化' USING ERRCODE='55000';
  END IF;

  SELECT c.oid INTO STRICT prior_subject FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=version_table AND c.contype='c' AND c.convalidated AND c.conislocal
      AND c.conname='ContractVersion_signing_subject_check'
      AND encode(public.digest(convert_to(pg_catalog.pg_get_constraintdef(c.oid,false),'UTF8'),'sha256'),'hex')=previous."subjectConstraintSha256";
  SELECT pg_catalog.pg_get_expr(c.conbin,c.conrelid,false) INTO STRICT prior_upward FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=version_table AND c.contype='c' AND c.convalidated AND c.conislocal
      AND c.conname='ContractVersion_upward_draft_source_check'
      AND encode(public.digest(convert_to(pg_catalog.pg_get_constraintdef(c.oid,false),'UTF8'),'sha256'),'hex')=previous."upwardConstraintSha256";

  -- Compare the historical definition to the exact 220 predicate before
  -- composing it as the first branch of the successor constraint.
  ALTER TABLE public."ContractVersion" ADD CONSTRAINT jg_generated_upward_direct_preimage CHECK (
    "signingSubjectType"<>'upward' OR (
      "numericProtocolVersion"=2 AND "versionNo"=1 AND "changeType"='original' AND "status"='draft'
      AND "effectiveAt" IS NULL AND "firstSubmittedAt" IS NULL AND "endedAt" IS NULL AND "supersedesVersionId" IS NULL
      AND "companyEntityIdSnapshot" IS NOT NULL AND "companyEntityVersionId" IS NOT NULL
      AND "companyEntityNameSnapshot" IS NOT NULL AND "companyEntityCreditCodeSnapshot" IS NOT NULL
      AND "affiliateAssignmentId" IS NOT NULL AND "affiliateBusinessPartyVersionId" IS NOT NULL AND "affiliateNameSnapshot" IS NOT NULL
      AND COALESCE("draftData"#>>'{directSigningInput,relationship}'='upward'
        AND "draftData"#>>'{directSigningInput,source}'='direct_signed'
        AND "draftData"#>'{directSigningInput,protocolVersion}'='2'::jsonb
        AND "draftData"#>>'{contractBasics,relationship}'='upward',FALSE)
    )
  ) NOT VALID;
  SELECT pg_catalog.pg_get_expr(c.conbin,c.conrelid,false) INTO STRICT expected_upward
    FROM pg_catalog.pg_constraint c WHERE c.conrelid=version_table AND c.conname='jg_generated_upward_direct_preimage';
  IF expected_upward IS DISTINCT FROM prior_upward THEN
    RAISE EXCEPTION '原对上直签约束的语义不匹配' USING ERRCODE='55000';
  END IF;
  ALTER TABLE public."ContractVersion" DROP CONSTRAINT jg_generated_upward_direct_preimage;
  ALTER TABLE public."ContractVersion" DROP CONSTRAINT "ContractVersion_upward_draft_source_check";
  EXECUTE format('ALTER TABLE public."ContractVersion" ADD CONSTRAINT "ContractVersion_upward_draft_source_check" CHECK ((%s) OR (%s))',
    prior_upward,generated_predicate);

  SELECT c.oid, encode(public.digest(convert_to(pg_catalog.pg_get_constraintdef(c.oid,false),'UTF8'),'sha256'),'hex')
    INTO STRICT new_upward,new_upward_sha FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=version_table AND c.contype='c' AND c.convalidated AND c.conislocal
      AND c.conname='ContractVersion_upward_draft_source_check';
  IF new_upward_sha=previous."upwardConstraintSha256" THEN
    RAISE EXCEPTION '对上生成提交新约束未形成' USING ERRCODE='55000';
  END IF;

  -- Existing business permissions are prerequisites. Only the new technical
  -- witness is granted here, and only to the same exact application role.
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['signingSubjectType','status','firstSubmittedAt','readinessSnapshot',
      'companyEntityIdSnapshot','companyEntityVersionId','companyEntityNameSnapshot','companyEntityCreditCodeSnapshot',
      'companyEntityRegisteredAddressSnapshot','affiliateAssignmentId','affiliateBusinessPartyVersionId',
      'affiliateNameSnapshot','affiliateCreditCodeSnapshot','updatedAt']) a(name)
      WHERE pg_catalog.has_column_privilege(app,version_table,a.name,'UPDATE') IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION '应用角色缺少既有对上生成提交写入资格' USING ERRCODE='55000';
  END IF;
  EXECUTE format('GRANT SELECT ON TABLE public.jg_contract_generated_upward_submission_binding_v1 TO %I',app_name);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid=successor_table AND a.grantee=app AND a.grantor=owner_id AND a.privilege_type='SELECT' AND NOT a.is_grantable)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid=successor_table AND (a.grantor<>owner_id OR a.grantee<>owner_id AND
        (a.grantee<>app OR a.privilege_type<>'SELECT' OR a.is_grantable)))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=successor_table
      AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(app,r.oid,'MEMBER')
      AND pg_catalog.has_table_privilege(r.oid,successor_table,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) THEN
    RAISE EXCEPTION '对上生成提交绑定技术授权不匹配' USING ERRCODE='55000';
  END IF;
  INSERT INTO public.jg_contract_generated_upward_submission_binding_v1(
    "protocolVersion","applicationRoleOid","databaseOid","namespaceOid","ownerOid","predecessorOid",
    "predecessorSha256","subjectConstraintOid","upwardConstraintOid","upwardConstraintSha256","sealHandoffEnabled")
  VALUES(1,app,db,ns,owner_id,previous_table,
    encode(public.digest(convert_to(to_jsonb(previous)::text,'UTF8'),'sha256'),'hex'),
    prior_subject,new_upward,new_upward_sha,TRUE);
END;
$install_generated_upward$;

COMMIT;
