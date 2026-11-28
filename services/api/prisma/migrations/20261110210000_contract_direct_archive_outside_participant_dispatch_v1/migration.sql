-- Add only the disabled-ledger outside direct path to the existing POL-284
-- trigger. This does not enable the writer or grant its generated manifest.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

DO $install$
DECLARE
  target_oid OID := pg_catalog.to_regprocedure('public."requireActiveProjectParticipatingCompany"()');
  guard_oid OID := pg_catalog.to_regprocedure(
    'public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion")');
  namespace_oid OID := pg_catalog.to_regnamespace('public');
  owner_oid OID := current_user::pg_catalog.regrole::oid;
  original RECORD;
  updated_body TEXT;
  old_call CONSTANT TEXT := $old$  IF TG_TABLE_NAME = 'ContractVersion' THEN
    candidate_fact_date := COALESCE(public.jg_contract_archive_v2_ownership_day(NEW."id"), COALESCE(NEW."effectiveAt", NEW."createdAt")::DATE);
  END IF;$old$;
  direct_call CONSTANT TEXT := $direct$  -- Direct archive has its own exact source and consumed-intent proof. The
  -- generated manifest date must not run for this one disabled-ledger write.
  IF TG_TABLE_SCHEMA = 'public' AND TG_TABLE_NAME = 'ContractVersion' AND TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'draft' AND NEW."status" = 'effective'
      AND OLD."id" = NEW."id" AND OLD."contractId" = NEW."contractId"
      AND OLD."draftData"#>'{directSigningInput,protocolVersion}' = '1'::jsonb
      AND OLD."draftData"#>>'{directSigningInput,source}' = 'direct_signed'
      AND OLD."draftData"#>>'{directSigningInput,relationship}' = 'outside'
      AND current_user IS DISTINCT FROM session_user
      AND pg_catalog.has_function_privilege(current_user,
        'public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion")',
        'EXECUTE') THEN
      PERFORM public.jg_check_contract_direct_archive_intent_roles_v1(false);
      PERFORM 1 FROM public."Project" p WHERE p."id" = target_project_id
        AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NULL FOR UPDATE;
      IF FOUND THEN
        RETURN public.jg_guard_contract_direct_archive_version_transition_v1(
          OLD::public."ContractVersion", NEW::public."ContractVersion");
      END IF;
    END IF;
  END IF;

$direct$;
BEGIN
  SELECT p.*, pg_catalog.to_jsonb(p)-'prosrc' AS metadata INTO STRICT original
  FROM pg_catalog.pg_proc p
  WHERE p.oid=target_oid AND p.pronamespace=namespace_oid AND p.proowner=owner_oid
    AND p.prokind='f' AND p.prorettype='pg_catalog.trigger'::pg_catalog.regtype
    AND NOT p.prosecdef AND p.provolatile='v' AND p.proconfig IS NULL;
  IF current_user IS DISTINCT FROM session_user
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(original.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'aa2a2ac7910ca8ab8cc3412ec7a50b3523f58238d446a07afc3182e873614c28'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public."ContractVersion"'::pg_catalog.regclass
        AND t.tgname='ContractVersion_require_active_participant' AND t.tgfoid=target_oid
        AND t.tgtype=23 AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable
        AND t.tgnargs=0 AND t.tgattr=''::pg_catalog.int2vector AND t.tgqual IS NULL)
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid=guard_oid AND p.pronamespace=namespace_oid AND p.proowner=owner_oid
        AND p.prokind='f' AND p.prorettype='public."ContractVersion"'::pg_catalog.regtype
        AND NOT p.prosecdef AND p.proisstrict AND p.provolatile='v'
        AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='c376d219b8d97e2d8e895f39fcf6af1b768fef8ae2dff9c37d356d8374086157')
  THEN
    RAISE EXCEPTION '表外直签参与方守卫的安装前态不匹配' USING ERRCODE='55000';
  END IF;
  IF (pg_catalog.length(original.prosrc)-pg_catalog.length(pg_catalog.replace(original.prosrc,old_call,'')))
      / pg_catalog.length(old_call) <> 1 THEN
    RAISE EXCEPTION '合同参与方归档日期锚点不匹配' USING ERRCODE='55000';
  END IF;
  updated_body:=pg_catalog.replace(original.prosrc,old_call,direct_call||old_call);
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(updated_body,'UTF8')),'hex') IS DISTINCT FROM '9b3b12c796afc49722d8277d10705277021c89897444f1a6b192d40df2be5f9c' THEN
    RAISE EXCEPTION '表外直签参与方守卫的安装后态不匹配' USING ERRCODE='55000';
  END IF;
  EXECUTE pg_catalog.replace(pg_catalog.pg_get_functiondef(target_oid),original.prosrc,updated_body);
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=target_oid
    AND p.prosrc=updated_body AND pg_catalog.to_jsonb(p)-'prosrc'=original.metadata) THEN
    RAISE EXCEPTION '表外直签参与方守卫不得改变既有对象身份' USING ERRCODE='55000';
  END IF;
END;
$install$;
COMMIT;
