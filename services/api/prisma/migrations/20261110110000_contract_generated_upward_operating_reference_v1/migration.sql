-- Generated upward archives on enabled projects record only the frozen internal reference.
-- The previously installed application profiles must qualify these exact successors before use.
BEGIN;
SET LOCAL search_path TO pg_catalog,public;

LOCK TABLE public."ContractArchiveFile",public.jg_contract_generated_archive_completion_v1,
  public.jg_contract_generated_archive_write_v1 IN ACCESS EXCLUSIVE MODE;

CREATE FUNCTION public.jg_verify_generated_upward_archive_reference_v1(version_id TEXT, authority JSONB, archived_at TIMESTAMP)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $policy$
DECLARE
  origin RECORD;
  identity JSONB;
  company JSONB;
  enterprise JSONB;
  parties JSONB;
  business_day DATE;
BEGIN
  IF archived_at IS NULL OR NOT EXISTS(SELECT 1 FROM public.jg_contract_generated_upward_seal_binding_v1 b
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public')
      AND ((current_user=session_user AND current_user::regrole::oid IN (b."applicationRoleOid",b."ownerOid"))
        OR (current_user::regrole::oid=b."ownerOid" AND session_user::regrole::oid=b."applicationRoleOid"))
      AND pg_catalog.current_setting('session_replication_role')='origin')
    OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN (
      'public."OperatingFact"'::regclass,'public."OperatingImpactEntry"'::regclass)
      AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)<>2 THEN RETURN FALSE; END IF;

  SELECT v.*,c."ownerUserId",c."projectId",c."companyEntityId",c."code",p."operatingLedgerEffectiveDate"
    INTO origin FROM public."ContractVersion" v JOIN public."Contract" c ON c."id"=v."contractId"
    JOIN public."Project" p ON p."id"=c."projectId"
    WHERE v."id"=version_id AND v."signingSubjectType"='upward' AND v."numericProtocolVersion"=2
      AND v."changeType"='original' AND v."versionNo"=1 AND v."firstSubmittedAt" IS NOT NULL
      AND v."supersedesVersionId" IS NULL AND v."status" IN ('seal_approved_pending_archive','effective')
      AND NOT (v."draftData"?'directSigningInput') AND c."voidedAt" IS NULL
      AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NOT NULL;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  identity:=authority#>'{sourceBasis,subjects,signingIdentity}';
  company:=identity->'company';
  enterprise:=identity->'enterprise';
  parties:=authority#>'{sourceBasis,subjects,parties}';
  business_day:=((archived_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::DATE;
  IF authority->>'archiveSource' IS DISTINCT FROM 'generated_approval'
    OR authority->>'projectId' IS DISTINCT FROM origin."projectId"
    OR authority->>'contractId' IS DISTINCT FROM origin."contractId"
    OR authority->>'contractVersionId' IS DISTINCT FROM origin."id"
    OR authority->>'handlerUserId' IS DISTINCT FROM origin."ownerUserId"
    OR authority->>'archivedAt' IS DISTINCT FROM to_char(archived_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    OR authority#>>'{sourceBasis,businessTime,businessDay}' IS DISTINCT FROM business_day::text
    OR authority->'operatingConsequence' IS DISTINCT FROM jsonb_build_object('protocolVersion',1,
      'mode','internal_reference_only','operatingLedgerEffectiveDateSnapshot',origin."operatingLedgerEffectiveDate",'expectedSource',NULL)
    OR identity IS DISTINCT FROM origin."readinessSnapshot"->'signingIdentity'
    OR identity->'protocolVersion' IS DISTINCT FROM '1'::jsonb OR identity->>'relationship' IS DISTINCT FROM 'upward'
    OR identity->>'roleSource' IS DISTINCT FROM 'document_company_selection_party_a_and_assignment_party_b'
    OR company->>'domain' IS DISTINCT FROM 'company_entity_version' OR company->>'roleKey' IS DISTINCT FROM 'party_a'
    OR company->'displayOrder' IS DISTINCT FROM '0'::jsonb
    OR company->>'companyEntityId' IS DISTINCT FROM origin."companyEntityId"
    OR company->>'companyEntityId' IS DISTINCT FROM origin."companyEntityIdSnapshot"
    OR company->>'id' IS DISTINCT FROM origin."companyEntityVersionId"
    OR enterprise->>'domain' IS DISTINCT FROM 'project_affiliate_assignment'
    OR enterprise->>'roleKey' IS DISTINCT FROM 'party_b' OR enterprise->'displayOrder' IS DISTINCT FROM '0'::jsonb
    OR enterprise->>'assignmentId' IS DISTINCT FROM origin."affiliateAssignmentId"
    OR enterprise->>'businessPartyVersionId' IS DISTINCT FROM origin."affiliateBusinessPartyVersionId"
    OR parties IS DISTINCT FROM origin."readinessSnapshot"->'parties'
    OR jsonb_typeof(parties) IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;

  IF jsonb_array_length(parties)<>1 OR NOT EXISTS(
    SELECT 1 FROM public."ProjectParticipatingCompany" pc
    JOIN public."CompanyEntityVersion" selected ON selected."id"=origin."companyEntityVersionId"
      AND selected."companyEntityId"=pc."companyEntityId"
    JOIN public."CompanyEntityVersion" joined ON joined."id"=pc."companyEntityVersionId" AND joined."companyEntityId"=pc."companyEntityId"
    WHERE pc."id"=company->>'projectParticipatingCompanyId' AND pc."projectId"=origin."projectId"
      AND pc."companyEntityId"=origin."companyEntityIdSnapshot" AND joined."id"=company->>'joinedCompanyEntityVersionId'
      AND selected."name"=origin."companyEntityNameSnapshot"
      AND selected."unifiedSocialCreditCode"=origin."companyEntityCreditCodeSnapshot"
      AND selected."registeredAddress" IS NOT DISTINCT FROM origin."companyEntityRegisteredAddressSnapshot"
      AND pc."effectiveFrom"<=business_day AND (pc."endedAt" IS NULL OR pc."endedAt">business_day)
  ) OR NOT EXISTS(
    SELECT 1 FROM public."ProjectAffiliateAssignment" a
    JOIN public."BusinessPartyVersion" ev ON ev."id"=a."businessPartyVersionId" AND ev."businessPartyId"=a."businessPartyId"
    JOIN public."ContractPartySnapshot" party ON party."id"=enterprise->>'partySnapshotId'
      AND party."contractVersionId"=origin."id" AND party."roleKey"='party_b' AND party."displayOrder"=0
      AND party."businessPartyVersionId"=ev."id" AND party."snapshot"=ev."snapshot"
    WHERE a."id"=origin."affiliateAssignmentId" AND a."projectId"=origin."projectId"
      AND a."businessPartyId"=enterprise->>'businessPartyId' AND ev."id"=enterprise->>'businessPartyVersionId'
      AND a."affiliateNameSnapshot"=origin."affiliateNameSnapshot"
      AND a."affiliateCreditCodeSnapshot" IS NOT DISTINCT FROM origin."affiliateCreditCodeSnapshot"
      AND parties->0->>'id'=party."id" AND parties->0->>'roleKey'=party."roleKey"
      AND parties->0->'displayOrder'=to_jsonb(party."displayOrder")
      AND parties->0->>'businessPartyVersionId'=ev."id" AND parties->0->'snapshot'=party."snapshot"
  ) THEN RETURN FALSE; END IF;

  -- The version ID is global. A wrongly projected row in another project still invalidates the reference.
  RETURN NOT EXISTS(SELECT 1 FROM public."OperatingFact" f WHERE f."sourceType"='contract_version' AND f."sourceBusinessId"=version_id)
     AND NOT EXISTS(SELECT 1 FROM public."OperatingImpactEntry" i WHERE i."sourceType"='contract_version' AND i."sourceBusinessId"=version_id);
END;
$policy$;
REVOKE ALL ON FUNCTION public.jg_verify_generated_upward_archive_reference_v1(TEXT,JSONB,TIMESTAMP) FROM PUBLIC;

DO $install$
DECLARE
  seal RECORD;
  prior RECORD;
  recipe RECORD;
  app_name NAME;
  owner_id OID:=current_user::regrole::oid;
  helper OID:=pg_catalog.to_regprocedure('public.jg_verify_generated_upward_archive_reference_v1(text,jsonb,timestamp)');
  successor TEXT;
  parent_old TEXT:=$parent_old$  ELSE
    IF (e #>> '{operatingConsequence,mode}') IS DISTINCT FROM 'projection_required'
$parent_old$;
  parent_next TEXT:=$parent_next$  ELSIF (e #>> '{operatingConsequence,mode}')='internal_reference_only' OR EXISTS(
    SELECT 1 FROM public."ContractVersion" uv WHERE uv."id"=NEW."contractVersionId" AND uv."signingSubjectType"='upward'
  ) THEN
    IF public.jg_verify_generated_upward_archive_reference_v1(NEW."contractVersionId",e,NEW."confirmedAt") IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION '对上合同必须冻结真实内部往来依据，不能形成经营事实' USING ERRCODE='23514';
    END IF;
  ELSE
    IF (e #>> '{operatingConsequence,mode}') IS DISTINCT FROM 'projection_required'
$parent_next$;
  capture_old TEXT:=$capture_old$  IF project_row."id" IS NULL OR project_row."isActive" IS DISTINCT FROM true OR project_row."operatingLedgerEffectiveDate" IS NOT NULL
    OR archive_row."authoritySnapshot"->'operatingConsequence' IS DISTINCT FROM
      '{"protocolVersion":1,"mode":"not_applicable","operatingLedgerEffectiveDateSnapshot":null,"expectedSource":null}'::jsonb
$capture_old$;
  capture_next TEXT:=$capture_next$  completion_policy:=CASE
    WHEN project_row."operatingLedgerEffectiveDate" IS NULL AND archive_row."authoritySnapshot"->'operatingConsequence'=
      '{"protocolVersion":1,"mode":"not_applicable","operatingLedgerEffectiveDateSnapshot":null,"expectedSource":null}'::jsonb
      THEN 'operating_ledger_not_enabled'
    WHEN relationship='upward' AND public.jg_verify_generated_upward_archive_reference_v1(version_row."id",
      archive_row."authoritySnapshot",archive_row."confirmedAt") THEN 'upward_internal_reference'
  END;
  IF project_row."id" IS NULL OR project_row."isActive" IS DISTINCT FROM true OR completion_policy IS NULL
$capture_next$;
  basis_gate_old TEXT:=$basis_gate_old$  -- Each enabled mode needs its own durable evidence and is still closed.
  IF policy IS DISTINCT FROM 'operating_ledger_not_enabled' THEN
$basis_gate_old$;
  basis_gate_next TEXT:=$basis_gate_next$  -- Downstream commitment requires its own fact and impact authority.
  IF policy IS NULL OR policy NOT IN ('operating_ledger_not_enabled','upward_internal_reference') THEN
$basis_gate_next$;
  basis_marker_old TEXT:=$basis_marker_old$      OR marker."completion"->>'policy' IS DISTINCT FROM policy
$basis_marker_old$;
  basis_marker_next TEXT:=$basis_marker_next$      OR marker."completion"->>'policy' IS DISTINCT FROM policy
      OR (policy='upward_internal_reference' AND (
        jsonb_typeof(marker."completion"->'operatingLedgerEffectiveDateSnapshot') IS DISTINCT FROM 'string'
        OR source->'operatingConsequence' IS DISTINCT FROM jsonb_build_object('protocolVersion',1,'mode','internal_reference_only',
          'operatingLedgerEffectiveDateSnapshot',marker."completion"->'operatingLedgerEffectiveDateSnapshot','expectedSource',NULL)
        OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN (
          'public."OperatingFact"'::regclass,'public."OperatingImpactEntry"'::regclass)
          AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)<>2
        OR EXISTS(SELECT 1 FROM public."OperatingFact" f WHERE f."sourceType"='contract_version' AND f."sourceBusinessId"=version_row."id")
        OR EXISTS(SELECT 1 FROM public."OperatingImpactEntry" i WHERE i."sourceType"='contract_version' AND i."sourceBusinessId"=version_row."id")))
$basis_marker_next$;
  basis_pending_old TEXT:=$basis_pending_old$    OR project_row."operatingLedgerEffectiveDate" IS NOT NULL
$basis_pending_old$;
  basis_pending_next TEXT:=$basis_pending_next$    OR (policy='operating_ledger_not_enabled' AND project_row."operatingLedgerEffectiveDate" IS NOT NULL)
    OR (policy='upward_internal_reference' AND public.jg_verify_generated_upward_archive_reference_v1(version_row."id",source,
      archive_row."confirmedAt") IS DISTINCT FROM TRUE)
$basis_pending_next$;
  command_select_old TEXT:=$command_select_old$  SELECT a."id",a."contractVersionId",v."status",v."signingSubjectType",p."operatingLedgerEffectiveDate" INTO parent
$command_select_old$;
  command_select_next TEXT:=$command_select_next$  SELECT a."id",a."contractVersionId",a."authoritySnapshot",a."confirmedAt",
    v."status",v."signingSubjectType",p."operatingLedgerEffectiveDate" INTO parent
$command_select_next$;
  command_gate_old TEXT:=$command_gate_old$  IF NOT FOUND OR parent."operatingLedgerEffectiveDate" IS NOT NULL THEN
$command_gate_old$;
  command_gate_next TEXT:=$command_gate_next$  IF NOT FOUND OR (parent."operatingLedgerEffectiveDate" IS NOT NULL AND
    (parent."signingSubjectType" IS DISTINCT FROM 'upward' OR public.jg_verify_generated_upward_archive_reference_v1(
      parent."contractVersionId",parent."authoritySnapshot",parent."confirmedAt") IS DISTINCT FROM TRUE)) THEN
$command_gate_next$;
BEGIN
  SELECT b.* INTO STRICT seal FROM public.jg_contract_generated_upward_seal_binding_v1 b
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public');
  SELECT rolname INTO STRICT app_name FROM pg_catalog.pg_roles WHERE oid=seal."applicationRoleOid";
  IF current_user IS DISTINCT FROM session_user OR owner_id IS DISTINCT FROM seal."ownerOid"
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(seal."applicationRoleOid",r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR pg_catalog.pg_has_role(r.oid,owner_id,'MEMBER')
        OR pg_catalog.has_schema_privilege(r.oid,seal."namespaceOid",'CREATE')))
    OR NOT EXISTS(SELECT 1 FROM public.jg_contract_generated_archive_version_transition_v1 v
      JOIN public.jg_contract_generated_upward_seal_binding_v1 b ON b.tableoid=v."sealBindingOid" AND b."protocolVersion"=1
      WHERE v."protocolVersion"=1 AND encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')=v."sealBindingSha256")
    OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN (
      'public.jg_contract_generated_archive_completion_v1'::regclass,'public.jg_contract_generated_archive_write_v1'::regclass)
      AND c.relowner=owner_id AND c.relnamespace=seal."namespaceOid" AND c.relkind='r'
      AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)<>2
    OR (SELECT count(*) FROM (VALUES
      ('ContractArchiveFile_v2_immutable','public."ContractArchiveFile"','public.jg_contract_archive_v2_parent_guard()',31,FALSE),
      ('ContractArchiveFile_v2_complete','public."ContractArchiveFile"','public.jg_contract_archive_v2_complete_guard()',5,TRUE),
      ('jg_generated_archive_completion_append','public.jg_contract_generated_archive_completion_v1','public.jg_guard_generated_archive_completion_v1()',31,FALSE),
      ('jg_generated_archive_completion_verify','public.jg_contract_generated_archive_completion_v1','public.jg_guard_generated_archive_completion_v1()',5,TRUE),
      ('jg_generated_archive_write_apply','public.jg_contract_generated_archive_write_v1','public.jg_apply_generated_archive_write_v1()',5,FALSE)
    ) wanted(name,relation,fn,kind,deferred) JOIN pg_catalog.pg_trigger t
      ON t.tgname=wanted.name AND t.tgrelid=pg_catalog.to_regclass(wanted.relation)
      AND t.tgfoid=pg_catalog.to_regprocedure(wanted.fn) AND t.tgtype=wanted.kind
      AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable=wanted.deferred AND t.tginitdeferred=wanted.deferred
      AND (t.tgconstraint<>0)=wanted.deferred AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='')<>5 THEN
    RAISE EXCEPTION '对上内部往来依据安装身份或归档前置关系不匹配' USING ERRCODE='55000';
  END IF;

  FOR recipe IN SELECT * FROM (VALUES
    ('parent','public.jg_contract_archive_v2_parent_guard()','f9de843279039250da6f56cc481d8d1f80e247431c7060aa637821a7bae7eff8','cbc9b7890e3fe02c730c1fa8617eb8b13b74a401c962083506d8a3372ec7a522','pg_catalog.trigger',FALSE,'search_path=pg_catalog, public'),
    ('capture','public.jg_capture_generated_archive_completion_v1(text)','802380ee6a481f49a77986ab828b0b48d00d263313360dccf36991eb5387b3b3','ebc6784cf581ecc1f53f53e1cafcaafadba6004b8a6a0ef71f4e94f3ae872f6d','pg_catalog.jsonb',FALSE,'search_path=pg_catalog, public'),
    ('basis','public.jg_generated_archive_activation_basis_v1(text,boolean)','7d231034f736945ec01332f494a33dba7e816eb54aefaae56d13a149c62a2f56','bd3a09f489d37ed5053ac86435053e593ffabd96aeebc9e94b30e335cbc9850f','pg_catalog.date',FALSE,'search_path=pg_catalog, pg_temp'),
    ('command','public.jg_apply_generated_archive_write_v1()','42829c50f2ea019a5e6d2dd2864cad10fd1f1515b709d4ebeadd9889ee64837d','03174cabf7b24f57ddad58ecf2c92360caa32f6d84299d3ab8ac4117d9f8465f','pg_catalog.trigger',TRUE,'search_path=pg_catalog, pg_temp')
  ) r(key,signature,old_sha,new_sha,result_type,definer,path) LOOP
    SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=pg_catalog.to_regprocedure(recipe.signature) AND p.proowner=owner_id
        AND p.pronamespace=seal."namespaceOid" AND p.prokind='f' AND p.provolatile='v'
        AND p.prorettype=pg_catalog.to_regtype(recipe.result_type) AND p.prosecdef=recipe.definer
        AND p.proconfig=ARRAY[recipe.path] AND NOT p.proisstrict AND NOT p.proretset
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=recipe.old_sha;
    successor:=prior.prosrc;
    CASE recipe.key
      WHEN 'parent' THEN successor:=replace(successor,parent_old,parent_next);
      WHEN 'capture' THEN
        successor:=replace(successor,E'  relationship TEXT;\n',E'  relationship TEXT;\n  completion_policy TEXT;\n');
        successor:=replace(successor,capture_old,capture_next);
        successor:=replace(successor,'生成合同归档完成记录只适用于未启用经营台账的项目','生成合同归档完成记录缺少对应经营依据或已有经营事实');
        successor:=replace(successor,$policy_value$'policy','operating_ledger_not_enabled'$policy_value$,$policy_value$'policy',completion_policy$policy_value$);
        successor:=replace(successor,$receipt_old$'evidenceIds',evidence_ids,'originals',originals);$receipt_old$,$receipt_next$'evidenceIds',evidence_ids,'originals',originals)
    || CASE WHEN completion_policy='upward_internal_reference' THEN
      jsonb_build_object('operatingLedgerEffectiveDateSnapshot',project_row."operatingLedgerEffectiveDate") ELSE '{}'::jsonb END;$receipt_next$);
      WHEN 'basis' THEN
        successor:=replace(successor,basis_gate_old,basis_gate_next);
        successor:=replace(successor,basis_marker_old,basis_marker_next);
        successor:=replace(successor,basis_pending_old,basis_pending_next);
      WHEN 'command' THEN
        successor:=replace(successor,command_select_old,command_select_next);
        successor:=replace(successor,command_gate_old,command_gate_next);
        successor:=replace(successor,'生成合同归档写入须绑定同事务原归档和未启用经营的项目','生成合同归档写入须绑定同事务原归档和对应经营依据');
    END CASE;
    IF encode(public.digest(convert_to(successor,'UTF8'),'sha256'),'hex') IS DISTINCT FROM recipe.new_sha THEN
      RAISE EXCEPTION '对上内部往来依据后继源码不匹配' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc,successor);
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=prior.oid AND p.prosrc=successor
      AND to_jsonb(p)-'prosrc'=prior.metadata) THEN
      RAISE EXCEPTION '对上内部往来依据改变了原归档例程身份' USING ERRCODE='55000';
    END IF;
  END LOOP;

  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_verify_generated_upward_archive_reference_v1(text,jsonb,timestamp) TO %I',app_name);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
    WHERE p.oid=helper AND a.grantee=seal."applicationRoleOid" AND a.grantor=owner_id
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
      WHERE p.oid=helper AND (a.grantor<>owner_id OR a.grantee<>owner_id AND
        (a.grantee<>seal."applicationRoleOid" OR a.privilege_type<>'EXECUTE' OR a.is_grantable))) THEN
    RAISE EXCEPTION '对上内部往来核验权限超出限定范围' USING ERRCODE='55000';
  END IF;
END;
$install$;

COMMIT;
