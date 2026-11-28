BEGIN;

CREATE TABLE public.jg_a08_outside_original_pair_v1 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  database_oid oid NOT NULL,
  system_identifier text NOT NULL,
  server_port integer NOT NULL CHECK (server_port BETWEEN 1025 AND 65535 AND server_port <> 5432),
  ordinary_role_oid oid NOT NULL,
  project_id text NOT NULL,
  version_id text NOT NULL,
  applicant_id text NOT NULL,
  claim_xid xid8,
  file_one text NOT NULL,
  sha_one text NOT NULL CHECK (sha_one ~ '^[a-f0-9]{64}$'),
  size_one integer NOT NULL CHECK (size_one > 0),
  mime_one text NOT NULL CHECK (mime_one IN ('application/pdf','image/jpeg','image/png')),
  file_two text NOT NULL,
  sha_two text NOT NULL CHECK (sha_two ~ '^[a-f0-9]{64}$'),
  size_two integer NOT NULL CHECK (size_two > 0),
  mime_two text NOT NULL CHECK (mime_two IN ('application/pdf','image/jpeg','image/png')),
  CHECK (file_one <> file_two)
);
REVOKE ALL ON public.jg_a08_outside_original_pair_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_confirm_a08_outside_original_pair_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $complete$
DECLARE
  scoped public.jg_a08_outside_original_pair_v1%ROWTYPE;
  old_version text;
  new_version text;
BEGIN
  IF TG_RELID='public.jg_a08_outside_original_pair_v1'::regclass AND TG_OP='UPDATE' THEN
    scoped:=NEW;
  ELSIF TG_RELID='public."ContractDraftAttachment"'::regclass THEN
    IF TG_OP IN ('UPDATE','DELETE') AND OLD."slotKey"='direct_signed_originals_v1' THEN
      old_version:=OLD."contractVersionId";
    END IF;
    IF TG_OP IN ('INSERT','UPDATE') AND NEW."slotKey"='direct_signed_originals_v1' THEN
      new_version:=NEW."contractVersionId";
    END IF;
    IF old_version IS NULL AND new_version IS NULL THEN RETURN NULL; END IF;
    SELECT b.* INTO scoped FROM public.jg_a08_outside_original_pair_v1 b
    WHERE b.singleton AND b.ordinary_role_oid=session_user::regrole::oid
      AND b.claim_xid=pg_current_xact_id_if_assigned() AND b.version_id IN (old_version,new_version);
    IF NOT FOUND THEN RETURN NULL; END IF;
  ELSE
    RAISE EXCEPTION 'A08_OUTSIDE_ORIGINAL_PAIR_COMPLETION_SCOPE' USING ERRCODE='55000';
  END IF;
  IF scoped.claim_xid IS DISTINCT FROM pg_current_xact_id()
    OR scoped.ordinary_role_oid IS DISTINCT FROM session_user::regrole::oid
    OR (SELECT count(*) FROM public."ContractDraftAttachment" a
      WHERE a."contractVersionId"=scoped.version_id AND a."slotKey"='direct_signed_originals_v1')<>2
    OR (SELECT count(*) FROM public."ContractDraftAttachment" a
      WHERE a."contractVersionId"=scoped.version_id AND a."slotKey"='direct_signed_originals_v1'
        AND a."createdByUserId"=scoped.applicant_id
        AND ((a."displayOrder"=0 AND a."fileId"=scoped.file_one)
          OR (a."displayOrder"=1 AND a."fileId"=scoped.file_two)))<>2 THEN
    RAISE EXCEPTION 'A08_OUTSIDE_ORIGINAL_PAIR_INCOMPLETE' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$complete$;
REVOKE ALL ON FUNCTION public.jg_confirm_a08_outside_original_pair_v1() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER jg_a08_outside_original_pair_complete
AFTER UPDATE ON public.jg_a08_outside_original_pair_v1
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (OLD.claim_xid IS NULL AND NEW.claim_xid IS NOT NULL)
EXECUTE FUNCTION public.jg_confirm_a08_outside_original_pair_v1();

CREATE FUNCTION public.jg_check_a08_outside_original_pair_v1(
  p_version text, p_file text, p_applicant text, p_order integer
) RETURNS boolean
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
SET search_path=pg_catalog, pg_temp AS $pair$
DECLARE
  scoped public.jg_a08_outside_original_pair_v1%ROWTYPE;
BEGIN
  IF pg_trigger_depth() NOT IN (0,1)
    OR current_setting('session_replication_role') <> 'origin'
    OR inet_client_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR NOT EXISTS (SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION 'A08_OUTSIDE_ORIGINAL_PAIR_SCOPE' USING ERRCODE='42501';
  END IF;
  IF NOT pg_try_advisory_xact_lock(190731,13) THEN
    RAISE EXCEPTION 'A08_OUTSIDE_ORIGINAL_PAIR_BUSY' USING ERRCODE='55P03';
  END IF;
  SELECT b.* INTO STRICT scoped
  FROM public.jg_a08_outside_original_pair_v1 b
  JOIN pg_database d ON d.oid=b.database_oid AND d.datname=current_database()
    AND d.datdba=current_user::regrole::oid AND d.datname ~ '^jg_task01_[a-f0-9]{32}$'
  JOIN pg_roles app ON app.oid=b.ordinary_role_oid AND app.oid=session_user::regrole::oid
    AND app.rolname ~ '^jg_fixture_app_[a-f0-9]{24}$' AND app.rolcanlogin
    AND NOT (app.rolsuper OR app.rolinherit OR app.rolcreaterole OR app.rolcreatedb OR app.rolreplication OR app.rolbypassrls)
    AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE app.oid IN (m.member,m.roleid))
  JOIN public."ContractVersion" v ON v.id=b.version_id AND v.id=p_version
    AND v.status='draft' AND v."numericProtocolVersion"=2 AND v."versionNo"=1 AND v."changeType"='original'
    AND v."supersedesVersionId" IS NULL AND v."firstSubmittedAt" IS NULL
    AND v."effectiveAt" IS NULL AND v."endedAt" IS NULL
    AND v."draftData"#>>'{directSigningInput,source}'='direct_signed'
    AND v."draftData"#>>'{directSigningInput,relationship}'='outside'
    AND v."draftData"#>>'{directSigningInput,protocolVersion}'='1'
  JOIN public."Contract" c ON c.id=v."contractId" AND c."projectId"=b.project_id
    AND c."ownerUserId"=b.applicant_id AND c."ownerUserId"=p_applicant
    AND c."contractTypeKey"='material_purchase' AND c."voidedAt" IS NULL
  JOIN public."Project" p ON p.id=c."projectId" AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NULL
  JOIN public."ProjectMember" member ON member."projectId"=p.id
    AND member."userId"=c."ownerUserId" AND member."positionKey"='contract_staff'
  JOIN public."User" applicant ON applicant.id=member."userId" AND applicant."isActive"
  WHERE b.singleton AND ((p_order=0 AND p_file=b.file_one) OR (p_order=1 AND p_file=b.file_two))
    AND b.server_port=inet_server_port()
    AND b.system_identifier=(SELECT system_identifier::text FROM pg_control_system())
    AND (b.claim_xid IS NULL OR b.claim_xid=pg_current_xact_id())
    AND NOT has_function_privilege(app.oid,'public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
  FOR SHARE OF v,c,p,member,applicant NOWAIT FOR UPDATE OF b NOWAIT;

  IF scoped.claim_xid IS NULL THEN
    UPDATE public.jg_a08_outside_original_pair_v1
    SET claim_xid=pg_current_xact_id() WHERE singleton AND claim_xid IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A08_OUTSIDE_ORIGINAL_PAIR_BUSY' USING ERRCODE='55P03';
    END IF;
  END IF;

  PERFORM f.id FROM public."FileObject" f
  WHERE f.id IN (scoped.file_one,scoped.file_two)
  ORDER BY f.id FOR UPDATE NOWAIT;

  IF (SELECT count(*) FROM public."FileObject" f
    JOIN (VALUES (scoped.file_one,scoped.sha_one,scoped.size_one,scoped.mime_one),
                 (scoped.file_two,scoped.sha_two,scoped.size_two,scoped.mime_two)) expected(id,sha,bytes,mime)
      ON f.id=expected.id
    WHERE f."uploadedByUserId"=scoped.applicant_id AND f."storageStatus"='active'
      AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
      AND f."contentSha256"=expected.sha AND f."sizeBytes"=expected.bytes AND f."mimeType"=expected.mime
      AND NOT EXISTS (SELECT FROM public."FileObject" next WHERE next."supersedesFileObjectId"=f.id)
    ) <> 2 THEN
    RAISE EXCEPTION 'A08_OUTSIDE_ORIGINAL_PAIR_BINDING' USING ERRCODE='55000';
  END IF;

  RETURN public.jg_project_owner_settlement_voucher_bound(p_file);
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'A08_OUTSIDE_ORIGINAL_PAIR_BINDING' USING ERRCODE='55000';
END;
$pair$;
REVOKE ALL ON FUNCTION public.jg_check_a08_outside_original_pair_v1(text,text,text,integer) FROM PUBLIC;

DO $install$
DECLARE
  expected record;
  actual record;
  definition text;
  updated text;
  owner_oid oid:=current_user::regrole::oid;
  guard_oid oid:=to_regprocedure('public.jg_enforce_exclusive_file_business_binding()');
  hook_before jsonb;
  closure_before text;
BEGIN
  IF current_user<>session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND datdba=owner_oid)
    OR NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('public.jg_project_owner_settlement_voucher_bound(text)')
      AND p.proowner=owner_oid AND p.prosecdef
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fdeab4bf7fe58fc59edc88ed38ce5b2950b3f8ce049983d8b3521f219ec8da14'
      AND (SELECT count(*)=1 AND bool_and(a.grantee=owner_oid AND a.grantor=owner_oid AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
        FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)) THEN
    RAISE EXCEPTION 'A08_OUTSIDE_PAIR_INSTALL_SCOPE' USING ERRCODE='55000';
  END IF;
  LOCK TABLE public.jg_contract_direct_upward_closure_v2,public."ContractDraftAttachment" IN SHARE ROW EXCLUSIVE MODE;
  closure_before:=public.jg_require_contract_direct_upward_source_v2();
  EXECUTE $attachment_hook$CREATE CONSTRAINT TRIGGER jg_a08_outside_original_pair_attachment_complete
AFTER INSERT OR UPDATE OR DELETE ON public."ContractDraftAttachment"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.jg_confirm_a08_outside_original_pair_v1();$attachment_hook$;
  SELECT to_jsonb(t) INTO STRICT hook_before FROM pg_trigger t WHERE t.tgfoid=guard_oid
    AND t.tgrelid='public."ContractDraftAttachment"'::regclass
    AND t.tgname='jg_direct_pending_attachment_exclusive' AND t.tgenabled='O' AND NOT t.tgisinternal;
  FOR expected IN SELECT * FROM (VALUES
    ('public.jg_enforce_exclusive_file_business_binding()','c70ff547812539fabd41f9fb0dc65cbc79550992121cfd994a489895cb40fb8b','07f8e2f8755381eb12f7872828627d3a886afa8334d7ea40070f79d8acd9fd29',$old$        ELSE
          binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id);
        END IF;$old$,$new$        ELSIF TG_RELID='public."ContractDraftAttachment"'::regclass AND TG_OP IN ('INSERT','UPDATE')
          AND to_jsonb(NEW)->>'slotKey'='direct_signed_originals_v1'
          AND current_user=session_user AND current_user::text ~ '^jg_fixture_app_[a-f0-9]{24}$'
          AND pg_catalog.has_function_privilege(current_user,'public.jg_check_a08_outside_original_pair_v1(text,text,text,integer)','EXECUTE') THEN
          binding_exists := public.jg_check_a08_outside_original_pair_v1(
            NEW."contractVersionId",candidate_file_id,NEW."createdByUserId",NEW."displayOrder");
        ELSE
          binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id);
        END IF;$new$,1),
    ('public.jg_require_contract_direct_upward_source_v2()','a8b68184019a527e0ab2c11ff823788608974c16a3654336a31a1dec50a575fe','07b12ab3310ba1713a1287c8e80481afe2f54f8592d6f958f2bd35a56caddd09',$old$encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c70ff547812539fabd41f9fb0dc65cbc79550992121cfd994a489895cb40fb8b'$old$,$new$(((encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c70ff547812539fabd41f9fb0dc65cbc79550992121cfd994a489895cb40fb8b') AND to_regprocedure('public.jg_check_a08_outside_original_pair_v1(text,text,text,integer)') IS NULL)
                OR (encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='07f8e2f8755381eb12f7872828627d3a886afa8334d7ea40070f79d8acd9fd29'
                  AND EXISTS(SELECT FROM pg_proc pair JOIN pg_class cap
                    ON cap.oid=to_regclass('public.jg_a08_outside_original_pair_v1')
                    WHERE pair.oid=to_regprocedure('public.jg_check_a08_outside_original_pair_v1(text,text,text,integer)')
                      AND pair.proowner=binding."anchorOwnerOid" AND pair.pronamespace=binding."namespaceOid"
                      AND cap.relowner=pair.proowner AND cap.relnamespace=pair.pronamespace AND cap.relkind='r'
                      AND NOT (cap.relrowsecurity OR cap.relforcerowsecurity OR cap.relispartition)
                      AND NOT EXISTS(SELECT FROM aclexplode(coalesce(cap.relacl,acldefault('r',cap.relowner))) a
                        WHERE a.grantee<>cap.relowner OR a.grantor<>cap.relowner)
                      AND NOT EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid=cap.oid AND a.attnum>0
                        AND NOT a.attisdropped AND a.attacl IS NOT NULL)
                      AND EXISTS(SELECT FROM pg_trigger t JOIN pg_proc completion ON completion.oid=t.tgfoid
                        WHERE t.tgrelid=cap.oid AND t.tgname='jg_a08_outside_original_pair_complete'
                          AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable AND t.tginitdeferred
                          AND t.tgtype=17 AND t.tgconstraint<>0
                          AND t.tgnargs=0 AND t.tgattr=''::int2vector AND t.tgqual IS NOT NULL
                          AND t.tgparentid=0 AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
                          AND substring(pg_get_triggerdef(t.oid,true) FROM ' WHEN [(](.*)[)] EXECUTE FUNCTION [^()]+[(][)]$')
                            IN ('old.claim_xid IS NULL AND new.claim_xid IS NOT NULL',
                              '(old.claim_xid IS NULL) AND (new.claim_xid IS NOT NULL)')
                          AND t.tgfoid=to_regprocedure('public.jg_confirm_a08_outside_original_pair_v1()')
                          AND completion.proowner=pair.proowner AND completion.pronamespace=pair.pronamespace
                          AND completion.prosecdef AND completion.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
                          AND encode(sha256(convert_to(completion.prosrc,'UTF8')),'hex')='98ee6ff313f930a2ca7bfb3e6a551c49ef493789328853e4fecf29c081c7f046'
                          AND (SELECT count(*)=1 AND bool_and(a.grantor=pair.proowner
                            AND a.grantee=pair.proowner AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
                            FROM aclexplode(completion.proacl) a))
                      AND pair.prosecdef AND pair.proisstrict AND pair.prokind='f' AND pair.provolatile='v'
                      AND pair.proparallel='u' AND NOT(pair.proleakproof OR pair.proretset)
                      AND pair.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
                      AND pair.prorettype='pg_catalog.bool'::regtype AND pair.pronargs=4 AND pair.pronargdefaults=0
                      AND pair.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
                      AND encode(sha256(convert_to(pair.prosrc,'UTF8')),'hex')='1e2a2c2eb9191178796cac4c10dad4f9c5a09403584fbe47d8e7be00a9b7f802'
                      AND (SELECT count(*) FILTER(WHERE a.grantee=pair.proowner)=1
                        AND bool_and(a.grantor=pair.proowner AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
                          AND (a.grantee=pair.proowner OR EXISTS(SELECT FROM public.jg_a08_outside_original_pair_v1 s
                            WHERE s.singleton AND s.ordinary_role_oid=a.grantee AND a.grantee=binding."applicationRoleOid")))
                        FROM aclexplode(pair.proacl) a))))$new$,2),
    ('public.jg_require_contract_direct_upward_source_v2()','07b12ab3310ba1713a1287c8e80481afe2f54f8592d6f958f2bd35a56caddd09','8a74f938325116c532b2a6763b2b26563605dbbd74723bee60c74e597149ca3c',$old$  IF jsonb_array_length(binding."triggers")+3<>(SELECT count(*) FROM pg_catalog.pg_trigger t$old$,$new$  IF NOT EXISTS(SELECT FROM pg_trigger t JOIN pg_proc f ON f.oid=t.tgfoid
    WHERE t.tgrelid='public."ContractDraftAttachment"'::regclass
      AND t.tgname='jg_a08_outside_original_pair_attachment_complete'
      AND t.tgtype=29 AND t.tgenabled='O' AND NOT t.tgisinternal
      AND t.tgconstraint<>0 AND t.tgdeferrable AND t.tginitdeferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr=''::int2vector
      AND t.tgparentid=0 AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
      AND f.oid=to_regprocedure('public.jg_confirm_a08_outside_original_pair_v1()')
      AND f.proowner=binding."anchorOwnerOid" AND f.pronamespace=binding."namespaceOid"
      AND f.prosecdef AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')='98ee6ff313f930a2ca7bfb3e6a551c49ef493789328853e4fecf29c081c7f046'
      AND (SELECT count(*)=1 AND bool_and(a.grantor=f.proowner AND a.grantee=f.proowner
        AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) FROM aclexplode(f.proacl) a)) THEN
    RAISE EXCEPTION 'A08_OUTSIDE_PAIR_ATTACHMENT_TRIGGER_MANIFEST' USING ERRCODE='55000';
  END IF;
  IF jsonb_array_length(binding."triggers")+4<>(SELECT count(*) FROM pg_catalog.pg_trigger t$new$,1),
    ('public.jg_upward_archive_catalog_projection_v2()','2f544d1510a89f322cd747f2bc279a1c4cecd87ca5c06db336a8e00d0e472e36','ebf786dd48b05ab47c62b283d702521ceb8edc00a0a8aa54f7194461560604b9',$old$a8b68184019a527e0ab2c11ff823788608974c16a3654336a31a1dec50a575fe$old$,$new$8a74f938325116c532b2a6763b2b26563605dbbd74723bee60c74e597149ca3c$new$,1),
    ('public.jg_upward_direct_archive_admission_v1()','5b7143aed3547bfd02a9ddf280139a4fc728c34e7cbacb3f6d8e420b91ea7f3d','eed377ea62bedf5b75e8d9b75afcb2ce132b8a1281d4fe0564525f836743c20e',$old$2f544d1510a89f322cd747f2bc279a1c4cecd87ca5c06db336a8e00d0e472e36$old$,$new$ebf786dd48b05ab47c62b283d702521ceb8edc00a0a8aa54f7194461560604b9$new$,1)
  ) pins(signature,prior_sha,next_sha,anchor,replacement,occurrences) LOOP
    SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT actual FROM pg_proc p
    WHERE p.oid=to_regprocedure(expected.signature) AND p.proowner=owner_oid AND p.pronamespace=to_regnamespace('public')
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.prior_sha;
    definition:=pg_get_functiondef(actual.oid);
    IF cardinality(string_to_array(definition,actual.prosrc))<>2
      OR cardinality(string_to_array(actual.prosrc,expected.anchor))<>expected.occurrences+1 THEN
      RAISE EXCEPTION 'A08_OUTSIDE_PAIR_INSTALL_PREIMAGE' USING ERRCODE='55000';
    END IF;
    updated:=replace(actual.prosrc,expected.anchor,expected.replacement);
    IF encode(sha256(convert_to(updated,'UTF8')),'hex')<>expected.next_sha THEN
      RAISE EXCEPTION 'A08_OUTSIDE_PAIR_INSTALL_DIGEST' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition,actual.prosrc,updated);
    IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=actual.oid AND p.prosrc=updated AND to_jsonb(p)-'prosrc'=actual.metadata) THEN
      RAISE EXCEPTION 'A08_OUTSIDE_PAIR_INSTALL_POSTIMAGE' USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT FROM pg_trigger t WHERE t.oid=(hook_before->>'oid')::oid AND to_jsonb(t)=hook_before)
    OR public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM closure_before THEN
    RAISE EXCEPTION 'A08_OUTSIDE_PAIR_INSTALL_CLOSURE' USING ERRCODE='55000';
  END IF;
END;
$install$;

COMMIT;
