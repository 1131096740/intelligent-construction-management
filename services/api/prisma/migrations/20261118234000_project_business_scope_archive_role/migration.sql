BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

DO $scope$
DECLARE
  owner_oid oid := current_user::regrole::oid;
  helper_oid oid := to_regprocedure('public.jg_check_general_procurement_archive_voucher_v1(text,text,text,text,integer)');
  trigger_oid oid := to_regprocedure('public.jg_general_procurement_archive_exclusive_guard_v1()');
  central_oid oid := to_regprocedure('public.jg_enforce_exclusive_file_business_binding()');
  raw_oid oid := to_regprocedure('public.jg_project_owner_settlement_voucher_bound(text)');
  central text;
  bound_trigger jsonb;
  prior_closure text;
  entry record;
  target record;
  next_body text;
  definition text;
  raw_branch CONSTANT text := $raw$        ELSE
          binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id);
        END IF;$raw$;
  archive_branch CONSTANT text := $branch$        ELSIF TG_RELID='public."GeneralProcurement"'::regclass AND TG_OP='UPDATE'
          AND current_user=session_user AND current_user='general_procurement_runtime'
          AND pg_catalog.has_function_privilege(current_user,'public.jg_check_general_procurement_archive_voucher_v1(text,text,text,text,integer)','EXECUTE') THEN
          IF OLD.status<>'approved_pending_archive' OR NEW.status<>'archived'
            OR OLD.id IS DISTINCT FROM NEW.id OR OLD."projectId" IS DISTINCT FROM NEW."projectId"
            OR OLD."approvalInstanceId" IS DISTINCT FROM NEW."approvalInstanceId"
            OR NEW.revision IS DISTINCT FROM OLD.revision+1 OR OLD."archiveFileId" IS NOT NULL
            OR NEW."archivedByUserId" IS NULL OR OLD."projectId" IS NULL THEN
            RAISE EXCEPTION 'GENERAL_PROCUREMENT_ARCHIVE_TRANSITION' USING ERRCODE='55000';
          END IF;
          binding_exists := public.jg_check_general_procurement_archive_voucher_v1(
            OLD.id,OLD."projectId",candidate_file_id,NEW."archivedByUserId",OLD.revision);
        ELSE
          binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id);
        END IF;$branch$;
BEGIN
  IF current_user<>session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS (SELECT FROM pg_database WHERE datname=current_database() AND datdba=owner_oid)
    OR NOT EXISTS (
      SELECT FROM pg_proc p WHERE p.oid=raw_oid AND p.proowner=owner_oid AND p.prosecdef
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fdeab4bf7fe58fc59edc88ed38ce5b2950b3f8ce049983d8b3521f219ec8da14'
        AND (SELECT count(*)=1 AND bool_and(a.grantee=owner_oid AND a.grantor=owner_oid
          AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
          FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)
    ) THEN
    RAISE EXCEPTION 'PROJECT_SCOPE_ARCHIVE_INSTALL_SCOPE' USING ERRCODE='55000';
  END IF;

  LOCK TABLE public."GeneralProcurement",public.jg_general_procurement_archive_binding_v1 IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT FROM public.jg_general_procurement_archive_binding_v1) THEN
    RAISE EXCEPTION 'PROJECT_SCOPE_ARCHIVE_BINDING_NOT_CLOSED' USING ERRCODE='55000';
  END IF;
  prior_closure:=public.jg_require_contract_direct_upward_source_v2();
  SELECT p.prosrc INTO STRICT central FROM pg_proc p
    WHERE p.oid=central_oid AND p.proowner=owner_oid AND NOT p.prosecdef
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c70ff547812539fabd41f9fb0dc65cbc79550992121cfd994a489895cb40fb8b';
  SELECT to_jsonb(t) INTO STRICT bound_trigger FROM pg_trigger t
    WHERE t.tgrelid='public."GeneralProcurement"'::regclass AND t.tgname='jg_efb_general_procurement_archive'
      AND t.tgfoid=trigger_oid AND t.tgenabled='O' AND t.tgtype=23 AND NOT t.tgisinternal
      AND t.tgqual IS NULL AND t.tgconstraint=0 AND t.tgnargs=2
      AND encode(t.tgargs,'hex')='6172636869766546696c6549640066616c736500'
      AND t.tgattr::text=(SELECT attnum::text FROM pg_attribute
        WHERE attrelid=t.tgrelid AND attname='archiveFileId' AND NOT attisdropped);
  IF cardinality(string_to_array(central,raw_branch))<>2 THEN
    RAISE EXCEPTION 'PROJECT_SCOPE_ARCHIVE_CENTRAL_PREIMAGE' USING ERRCODE='55000';
  END IF;

  FOR entry IN SELECT * FROM (VALUES
    (helper_oid,true,'f1c9c37f4dfe782dbfeb601e8a7c8842623c422160cff92a0588f80e51897c6e','fe997197590944906f20617401ab9a50dfc9db6799785a900929ded7ad6a3da8',NULL::text,
      $old$    AND app.rolname='general_procurement_runtime' AND app.rolcanlogin$old$,$new$    AND (app.rolname='general_procurement_runtime'
      OR (app.rolname='project_business_scope_runtime' AND b.project_id='legacy-project-business-scope'
        AND p_project='legacy-project-business-scope'))
    AND app.rolcanlogin$new$),
    (trigger_oid,false,NULL,NULL,replace(central,raw_branch,archive_branch),
      $old$          AND current_user=session_user AND current_user='general_procurement_runtime'$old$,$new$          AND current_user=session_user AND (current_user='general_procurement_runtime'
            OR (current_user='project_business_scope_runtime'
              AND OLD."projectId"='legacy-project-business-scope'))$new$)
  ) AS pins(oid,definer,old_sha,new_sha,old_body,anchor,replacement)
  LOOP
    SELECT p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT target
      FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=entry.oid AND p.pronamespace=to_regnamespace('public') AND p.proowner=owner_oid
        AND p.prosecdef=entry.definer
        AND (entry.old_sha IS NULL OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=entry.old_sha)
        AND (entry.old_body IS NULL OR p.prosrc=entry.old_body)
        AND NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee<>owner_oid OR a.grantor<>owner_oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable);
    definition:=pg_get_functiondef(entry.oid);
    IF cardinality(string_to_array(definition,target.prosrc))<>2
      OR cardinality(string_to_array(target.prosrc,entry.anchor))<>2 THEN
      RAISE EXCEPTION 'PROJECT_SCOPE_ARCHIVE_PREIMAGE' USING ERRCODE='55000';
    END IF;
    next_body:=replace(target.prosrc,entry.anchor,entry.replacement);
    IF entry.new_sha IS NOT NULL AND encode(sha256(convert_to(next_body,'UTF8')),'hex')<>entry.new_sha THEN
      RAISE EXCEPTION 'PROJECT_SCOPE_ARCHIVE_SUCCESSOR' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition,target.prosrc,next_body);
    IF NOT EXISTS (SELECT FROM pg_proc p WHERE p.oid=entry.oid AND p.prosrc=next_body
      AND to_jsonb(p)-'prosrc'=target.metadata) THEN
      RAISE EXCEPTION 'PROJECT_SCOPE_ARCHIVE_POSTIMAGE' USING ERRCODE='55000';
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT FROM pg_trigger t WHERE t.oid=(bound_trigger->>'oid')::oid AND to_jsonb(t)=bound_trigger)
    OR public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM prior_closure THEN
    RAISE EXCEPTION 'PROJECT_SCOPE_ARCHIVE_CONTINUITY' USING ERRCODE='55000';
  END IF;
END;
$scope$;

COMMIT;
