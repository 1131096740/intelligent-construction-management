BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

-- Only the controlled fixture owner supplies the one bound test transition.
-- Neither the table nor the fixed entry has a PUBLIC or default app grant.
CREATE TABLE public.jg_normal_generated_archive_activation_binding_v1 (
  singleton boolean PRIMARY KEY CHECK (singleton),
  database_oid oid NOT NULL,
  system_identifier text NOT NULL,
  server_port integer NOT NULL CHECK (server_port BETWEEN 1025 AND 65535),
  ordinary_role_oid oid NOT NULL,
  project_id text NOT NULL,
  applicant_id text NOT NULL,
  version_id text NOT NULL,
  assignment_id text NOT NULL,
  assignment_version_id text NOT NULL,
  archive_request_key text NOT NULL,
  originals jsonb NOT NULL CHECK (jsonb_typeof(originals)='array' AND jsonb_array_length(originals)=2)
);
REVOKE ALL ON TABLE public.jg_normal_generated_archive_activation_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_lock_normal_generated_archive_assignment_v1(p_version text) RETURNS void
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $lock$
DECLARE
  target record;
  assignment record;
  current_xmin text:=mod(pg_current_xact_id()::text::numeric,4294967296)::text;
BEGIN
  IF pg_trigger_depth()<>1 OR current_setting('session_replication_role')<>'origin'
    OR inet_client_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR NOT EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION 'NORMAL_ARCHIVE_ASSIGNMENT_SCOPE' USING ERRCODE='42501';
  END IF;

  SELECT p.id AS project_id,v."effectiveAt"::date AS fact_day,b.assignment_id,b.assignment_version_id,
    v."affiliateAssignmentId" AS version_assignment,v."affiliateBusinessPartyVersionId" AS version_assignment_version
    INTO STRICT target
  FROM public.jg_normal_generated_archive_activation_binding_v1 b
  JOIN pg_database d ON d.oid=b.database_oid AND d.datname=current_database()
    AND d.datdba=current_user::regrole::oid AND d.datname ~ '^jg_task01_[a-f0-9]{32}$'
  JOIN pg_roles app ON app.oid=b.ordinary_role_oid AND app.oid=session_user::regrole::oid
    AND app.rolname ~ '^jg_fixture_app_[a-f0-9]{24}$' AND app.rolcanlogin
    AND NOT (app.rolsuper OR app.rolinherit OR app.rolcreaterole OR app.rolcreatedb OR app.rolreplication OR app.rolbypassrls)
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members member WHERE app.oid IN (member.member,member.roleid))
  JOIN public."ContractVersion" v ON v.id=p_version AND v.id=b.version_id AND v.xmin::text=current_xmin
    AND v.status='effective' AND v."numericProtocolVersion"=2 AND v."versionNo"=1
    AND v."changeType"='original' AND v."supersedesVersionId" IS NULL AND v."signingSubjectType"='our_company'
    AND v."firstSubmittedAt" IS NOT NULL AND v."taxFactsFrozenAt"=v."effectiveAt"
    AND v."draftData"#>>'{contractBasics,relationship}'='inside'
  JOIN public."Contract" c ON c.id=v."contractId" AND c."projectId"=b.project_id AND c."ownerUserId"=b.applicant_id
    AND c."contractTypeKey"='equipment_rental' AND c."voidedAt" IS NULL
  JOIN public."Project" p ON p.id=c."projectId" AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NULL
  JOIN public."ContractArchiveFile" a ON a."contractVersionId"=v.id AND a.xmin::text=current_xmin
    AND a."archiveProtocolVersion"=2 AND a."archiveSource"='generated_approval' AND a.status='confirmed'
    AND a."idempotencyKey"=b.archive_request_key AND a."confirmedAt"=v."effectiveAt"
    AND a."uploadedByUserId"=b.applicant_id AND a."confirmedByUserId"=b.applicant_id
    AND a."sourceRevision"=v."draftRevision" AND a."documentContentRevision"=v."documentContentRevision"
    AND a."documentContentFingerprint"=v."documentContentFingerprint"
    AND a."requestSha256"=a."authoritySnapshot"->>'requestSha256'
    AND a."authoritySnapshot"->>'archiveSource'='generated_approval'
    AND a."authoritySnapshot"->>'projectId'=p.id AND a."authoritySnapshot"->>'contractId'=c.id
    AND a."authoritySnapshot"->>'contractVersionId'=v.id AND a."authoritySnapshot"->>'handlerUserId'=b.applicant_id
    AND a."authoritySnapshot"#>>'{operatingConsequence,mode}'='not_applicable'
    AND a."authoritySha256"=encode(sha256(convert_to(a."authoritySnapshot"::text,'UTF8')),'hex')
    AND a."fileManifestSha256"=encode(sha256(convert_to((a."authoritySnapshot"->'fileManifest')::text,'UTF8')),'hex')
  JOIN public."ApprovalInstance" round ON round.id=a."approvalInstanceId" AND round."businessId"=v.id
    AND round."businessType"='contract_version' AND round."flowType"='contract.approve'
    AND round."applicantUserId"=b.applicant_id AND round.status='approved'
  JOIN public."ContractSealTask" task ON task.id=a."sealTaskId" AND task."contractVersionId"=v.id
    AND task."approvalInstanceId"=round.id AND task."handlerUserId"=b.applicant_id AND task.status='completed'
    AND task."completedAt" IS NOT NULL AND task."completedByUserId" IS NOT NULL
  WHERE b.singleton AND b.server_port=inet_server_port()
    AND b.system_identifier=(SELECT system_identifier::text FROM pg_control_system())
    AND NOT has_any_column_privilege(app.oid,'public."ProjectAffiliateAssignment"'::regclass,'UPDATE')
    AND NOT has_column_privilege(app.oid,'public."Project"'::regclass,'constructionEnterpriseLockedAt','UPDATE')
    AND EXISTS(SELECT 1 FROM public."ProjectMember" member WHERE member."projectId"=p.id AND member."userId"=b.applicant_id
      AND member."positionKey"='contract_staff'
      AND EXISTS(SELECT 1 FROM public."User" applicant WHERE applicant.id=member."userId" AND applicant."isActive"))
    AND EXISTS(SELECT 1 FROM public."ProjectParticipatingCompany" company
      WHERE company."projectId"=p.id AND company."companyEntityId"=v."companyEntityIdSnapshot"
        AND company."companyEntityVersionId"=v."companyEntityVersionId"
        AND company."id"=a."authoritySnapshot"#>>'{sourceBasis,subjects,participation,id}'
        AND company."effectiveFrom"<=v."effectiveAt"::date
        AND (company."endedAt" IS NULL OR company."endedAt">v."effectiveAt"::date)
      FOR SHARE OF company)
    AND a."authoritySnapshot"->'fileManifest'=b.originals
    AND 2=(SELECT count(*) FROM public."ContractArchiveEvidenceFile" e
      JOIN public."FileObject" f ON f.id=e."fileId" AND f."uploadedByUserId"=b.applicant_id
        AND f."storageStatus"='active' AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
        AND f."contentSha256"=e."contentSha256" AND f."sizeBytes"=e."sizeBytes" AND f."mimeType"=e."mimeType"
      WHERE e."archiveFileId"=a.id AND e."contractVersionId"=v.id AND e.xmin::text=current_xmin
        AND a."authoritySnapshot"->'fileManifest'->e."displayOrder"=jsonb_build_object(
          'fileId',e."fileId",'displayOrder',e."displayOrder",'mimeType',e."mimeType",
          'sizeBytes',e."sizeBytes",'contentSha256',e."contentSha256"))
  FOR UPDATE OF p;

  SELECT a.id,a."businessPartyVersionId" INTO STRICT assignment
    FROM public."ProjectAffiliateAssignment" a
    WHERE a."projectId"=target.project_id AND a."effectiveFrom"<=target.fact_day AND a."endedAt" IS NULL
    FOR KEY SHARE;
  IF assignment.id IS DISTINCT FROM target.assignment_id
    OR assignment."businessPartyVersionId" IS DISTINCT FROM target.assignment_version_id
    OR target.version_assignment IS NOT NULL AND target.version_assignment<>assignment.id
    OR target.version_assignment_version IS NOT NULL AND target.version_assignment_version<>assignment."businessPartyVersionId" THEN
    RAISE EXCEPTION 'NORMAL_ARCHIVE_ASSIGNMENT_CHANGED' USING ERRCODE='23514';
  END IF;

  UPDATE public."Project" SET "constructionEnterpriseLockedAt"=COALESCE("constructionEnterpriseLockedAt",transaction_timestamp())
    WHERE id=target.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NORMAL_ARCHIVE_PROJECT_MARKER' USING ERRCODE='23514';
  END IF;
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'NORMAL_ARCHIVE_ASSIGNMENT_WITNESS' USING ERRCODE='55000';
END;
$lock$;
REVOKE ALL ON FUNCTION public.jg_lock_normal_generated_archive_assignment_v1(text) FROM PUBLIC;

-- Apply only the exact sealed 273 variants. Preserve all function and trigger identities.
LOCK TABLE public.jg_contract_direct_upward_closure_v2 IN SHARE ROW EXCLUSIVE MODE;
DO $normal_entry$
DECLARE
  owner_oid oid:=current_user::regrole::oid;
  expected record;
  actual record;
  definition text;
  successor text;
  before_sha text;
  lock_trigger jsonb;
  current_trigger jsonb;
  lock_oid oid:=to_regprocedure('public."lockProjectConstructionEnterpriseFromFormalFact"()');
  anchor CONSTANT text:=$anchor$  IF TG_TABLE_NAME = 'ContractVersion' THEN$anchor$;
  branch CONSTANT text:=$branch$  IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='ContractVersion' AND TG_OP='UPDATE' THEN
    IF OLD."status"='seal_approved_pending_archive' AND NEW."status"='effective'
      AND NEW."numericProtocolVersion"=2 AND NEW."signingSubjectType"='our_company'
      AND NEW."draftData"#>>'{contractBasics,relationship}'='inside'
      AND current_user=session_user
      AND current_user::text ~ '^jg_fixture_app_[a-f0-9]{24}$'
      AND pg_catalog.has_function_privilege(current_user,'public.jg_lock_normal_generated_archive_assignment_v1(text)','EXECUTE') THEN
      PERFORM public.jg_lock_normal_generated_archive_assignment_v1(NEW."id");
      RETURN NEW;
    END IF;
  END IF;
$branch$;
BEGIN
  IF current_user<>session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_database d WHERE d.datname=current_database() AND d.datdba=owner_oid)
    OR (SELECT count(*) FROM public.jg_contract_direct_upward_closure_v2)<>1 THEN
    RAISE EXCEPTION 'NORMAL_ARCHIVE_ASSIGNMENT_INSTALL_SCOPE' USING ERRCODE='55000';
  END IF;
  before_sha:=public.jg_require_contract_direct_upward_source_v2();
  SELECT to_jsonb(t) INTO STRICT lock_trigger FROM pg_trigger t WHERE t.tgfoid=lock_oid
    AND t.tgrelid='public."ContractVersion"'::regclass AND t.tgname='ContractVersion_lock_construction_enterprise'
    AND t.tgtype=21 AND t.tgenabled='O' AND NOT(t.tgisinternal OR t.tgdeferrable OR t.tginitdeferred)
    AND t.tgconstraint=0 AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
    AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL;

  FOR expected IN SELECT * FROM (VALUES
    ('public."lockProjectConstructionEnterpriseFromFormalFact"()','a2e4f66deffb69215b3be3301b361b4850c78b45f779b16c34f796179e0a126f','437dbc3b138068a70740aa9216b77d54a90e13f3b2c442f29e62abef2fb5ee4f',
      anchor,branch||anchor,NULL::text,NULL::text),
    ('public.jg_require_contract_direct_upward_source_v2()','1ae814013d8b88372a4d1a057f6507d9a2bfd1b06b64e7f3aacc6bfbc88596b6','bf9ba05391f12deedb29516366e75131bce00b3e1ef4ba030d40e7d9132639d6',
      $before$'a2e4f66deffb69215b3be3301b361b4850c78b45f779b16c34f796179e0a126f')))$before$,$after$'a2e4f66deffb69215b3be3301b361b4850c78b45f779b16c34f796179e0a126f',
                      '437dbc3b138068a70740aa9216b77d54a90e13f3b2c442f29e62abef2fb5ee4f')))$after$,$before$encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a2e4f66deffb69215b3be3301b361b4850c78b45f779b16c34f796179e0a126f'$before$,$after$(encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a2e4f66deffb69215b3be3301b361b4850c78b45f779b16c34f796179e0a126f' OR (encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='437dbc3b138068a70740aa9216b77d54a90e13f3b2c442f29e62abef2fb5ee4f'
                    AND EXISTS(SELECT 1 FROM pg_proc normal_lock
                      JOIN pg_language lang ON lang.oid=normal_lock.prolang AND lang.lanname='plpgsql'
                      WHERE normal_lock.oid=to_regprocedure('public.jg_lock_normal_generated_archive_assignment_v1(text)')
                        AND normal_lock.proowner=binding."anchorOwnerOid" AND normal_lock.pronamespace=binding."namespaceOid"
                        AND normal_lock.prokind='f' AND normal_lock.provolatile='v' AND normal_lock.proparallel='u'
                        AND normal_lock.prorettype='pg_catalog.void'::regtype AND normal_lock.prosecdef AND normal_lock.proisstrict
                        AND NOT(normal_lock.proretset OR normal_lock.proleakproof) AND normal_lock.pronargdefaults=0
                        AND normal_lock.provariadic=0 AND normal_lock.prosupport=0
                        AND normal_lock.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
                        AND encode(sha256(convert_to(normal_lock.prosrc,'UTF8')),'hex')='49d8560d487e6ee6f3aafeb75ea1081c3bf6916f6ab1a88e08983487c9af5e16'
                        AND NOT EXISTS(SELECT 1 FROM aclexplode(normal_lock.proacl) acl
                          WHERE acl.grantor<>normal_lock.proowner OR acl.privilege_type<>'EXECUTE'
                            OR acl.grantee NOT IN(normal_lock.proowner,binding."applicationRoleOid")
                            OR acl.grantee<>normal_lock.proowner AND acl.is_grantable))))$after$),
    ('public.jg_upward_archive_catalog_projection_v2()','f4254d80288f89f9ab18e5bc74cb30800234424616b7633643d5bbece2674ad5','da70dd04b24f47b535b0123d465ca92b67b87185f846fca89a938a4f455654ed',
      '1ae814013d8b88372a4d1a057f6507d9a2bfd1b06b64e7f3aacc6bfbc88596b6','bf9ba05391f12deedb29516366e75131bce00b3e1ef4ba030d40e7d9132639d6',NULL::text,NULL::text),
    ('public.jg_upward_direct_archive_admission_v1()','bc891187984689e844362dce318c574a67ec16e582bfdf446481562c0641078b','9fab3226f5baba20aa24f790eb1df477e45f062c57ca6175a22b13bda61f790c',
      'f4254d80288f89f9ab18e5bc74cb30800234424616b7633643d5bbece2674ad5','da70dd04b24f47b535b0123d465ca92b67b87185f846fca89a938a4f455654ed',NULL::text,NULL::text)
  ) AS p(signature, prior_sha, next_sha, first_anchor, first_replacement, second_anchor, second_replacement)
  LOOP
    SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT actual
      FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=to_regprocedure(expected.signature) AND p.proowner=owner_oid AND p.pronamespace=to_regnamespace('public')
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.prior_sha;
    definition:=pg_get_functiondef(actual.oid);
    IF cardinality(string_to_array(definition,actual.prosrc))<>2
      OR cardinality(string_to_array(actual.prosrc,expected.first_anchor))<>2
      OR (expected.second_anchor IS NOT NULL AND cardinality(string_to_array(actual.prosrc,expected.second_anchor))<>2) THEN
      RAISE EXCEPTION 'NORMAL_ARCHIVE_ASSIGNMENT_INSTALL_PREIMAGE' USING ERRCODE='55000';
    END IF;
    successor:=replace(actual.prosrc,expected.first_anchor,expected.first_replacement);
    IF expected.second_anchor IS NOT NULL THEN
      successor:=replace(successor,expected.second_anchor,expected.second_replacement);
    END IF;
    IF encode(sha256(convert_to(successor,'UTF8')),'hex')<>expected.next_sha THEN
      RAISE EXCEPTION 'NORMAL_ARCHIVE_ASSIGNMENT_INSTALL_DIGEST' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition,actual.prosrc,successor);
    IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=actual.oid AND p.prosrc=successor AND to_jsonb(p)-'prosrc'=actual.metadata) THEN
      RAISE EXCEPTION 'NORMAL_ARCHIVE_ASSIGNMENT_INSTALL_POSTIMAGE' USING ERRCODE='55000';
    END IF;
  END LOOP;
  SELECT to_jsonb(t) INTO STRICT current_trigger FROM pg_trigger t WHERE t.oid=(lock_trigger->>'oid')::oid;
  IF current_trigger IS DISTINCT FROM lock_trigger
    OR public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM before_sha THEN
    RAISE EXCEPTION 'NORMAL_ARCHIVE_ASSIGNMENT_INSTALL_CLOSURE' USING ERRCODE='55000';
  END IF;
END;
$normal_entry$;
COMMIT;
