BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- 04100 has installed the two hooks, so the old count guard cannot run until this succeeds.
DO $manifest$
DECLARE
  owner_oid oid := current_user::regrole::oid;
  expected record;
  actual record;
  definition text;
  successor text;
BEGIN
  IF current_user<>session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS (SELECT FROM pg_database WHERE datname=current_database() AND datdba=owner_oid)
    OR (SELECT count(*) FROM public.jg_contract_direct_upward_closure_v2)<>1 THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_FILE_TRIGGER_INSTALL_SCOPE' USING ERRCODE='55000';
  END IF;

  LOCK TABLE public."FileObject" IN ACCESS EXCLUSIVE MODE NOWAIT;

  FOR expected IN SELECT * FROM (VALUES
    ('public.jg_require_contract_direct_upward_source_v2()','d005d2656d61326258b6fd353c504731d4042e3081d5911e5bd9a7681c970552','607cc42deccbb17f6de375976b5ed0ef0cbb30805c24ab6d3fb7cf6be74fc5fe',
      $prior$  IF jsonb_array_length(binding."triggers")+4<>(SELECT count(*) FROM pg_catalog.pg_trigger t$prior$,$next$  -- Admit only the two fixed signed-settlement hooks in addition to the sealed set.
  IF (SELECT count(*) FROM (VALUES
      ('FileObject_signed_settlement_retention', 19, '',
        $retention_when$old."objectKey" ~~ 'uploads/signed-contract-settlement/%'::text OR new."objectKey" ~~ 'uploads/signed-contract-settlement/%'::text$retention_when$,
        'public.jg_guard_signed_settlement_file_retention()', false,
        '078f598a7343d70b2742a19ed092183d280af21579668d08e3d1694bb074604f'),
      ('FileObject_signed_settlement_replacement_target', 23,
        (SELECT attnum::text FROM pg_catalog.pg_attribute
          WHERE attrelid='public."FileObject"'::regclass AND attname='supersedesFileObjectId' AND NOT attisdropped),
        $replacement_when$new."supersedesFileObjectId" IS NOT NULL$replacement_when$,
        'public.jg_guard_signed_settlement_replacement_target()', true,
        '1c2160e5528fcfe2cd824e6a85da80f441ee8ccd8caa4fb8473c21154c8ff03e')
    ) expected(trigger_name,trigger_type,trigger_columns,trigger_when,routine,definer,routine_sha)
    JOIN pg_catalog.pg_trigger t ON t.tgrelid='public."FileObject"'::regclass AND t.tgname=expected.trigger_name
    JOIN pg_catalog.pg_proc f ON f.oid=t.tgfoid
    JOIN pg_catalog.pg_language l ON l.oid=f.prolang
    WHERE NOT t.tgisinternal AND t.tgconstraint=0 AND t.tgconstrrelid=0 AND t.tgconstrindid=0
      AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgparentid=0
      AND t.tgtype=expected.trigger_type AND t.tgenabled='O' AND t.tgnargs=0 AND t.tgargs=''::bytea
      AND t.tgattr::text=expected.trigger_columns AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
      AND substring(pg_catalog.pg_get_triggerdef(t.oid,true) FROM ' WHEN [(](.*)[)] EXECUTE FUNCTION [^()]+[(][)]$')
        =expected.trigger_when
      AND f.oid=pg_catalog.to_regprocedure(expected.routine)
      AND f.proowner=binding."anchorOwnerOid" AND f.pronamespace=binding."namespaceOid"
      AND l.lanname='plpgsql' AND f.prosecdef=expected.definer AND f.prokind='f'
      AND f.provolatile='v' AND f.proparallel='u' AND f.prorettype='pg_catalog.trigger'::regtype
      AND f.pronargs=0 AND f.pronargdefaults=0 AND f.provariadic=0 AND f.prosupport=0
      AND NOT(f.proretset OR f.proisstrict OR f.proleakproof)
      AND f.proconfig=ARRAY['search_path=pg_catalog, public']
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc,'UTF8')),'hex')=expected.routine_sha
      AND (SELECT count(*)=1
        AND bool_and(a.grantor=f.proowner AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
          AND a.grantee=f.proowner)
        FROM pg_catalog.aclexplode(COALESCE(f.proacl,pg_catalog.acldefault('f',f.proowner))) a))<>2 THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_FILE_TRIGGER_MANIFEST' USING ERRCODE='55000';
  END IF;
  IF jsonb_array_length(binding."triggers")+6<>(SELECT count(*) FROM pg_catalog.pg_trigger t$next$),
    ('public.jg_upward_archive_catalog_projection_v2()','105281430d2bd723a93626bc129ca497486787d6f8476b95f324a8b1d0324c9e','5fc49d0c0d0982b14dad70f9498c003dcffb4dfa9d1b7ae58155a93069f220b3',
      $prior$d005d2656d61326258b6fd353c504731d4042e3081d5911e5bd9a7681c970552$prior$,$next$607cc42deccbb17f6de375976b5ed0ef0cbb30805c24ab6d3fb7cf6be74fc5fe$next$),
    ('public.jg_upward_direct_archive_admission_v1()','bfbe61100be1d1705095a03e11c9ef6db48ca05d282aeff03c2d21ea137cb411','0ae95bf1a1b3551b5a123869077432a74578cb5c49ca63e7a4be4320eecef462',
      $prior$105281430d2bd723a93626bc129ca497486787d6f8476b95f324a8b1d0324c9e$prior$,$next$5fc49d0c0d0982b14dad70f9498c003dcffb4dfa9d1b7ae58155a93069f220b3$next$)
  ) pins(signature,prior_sha,next_sha,anchor,replacement)
  LOOP
    SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT actual
      FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=to_regprocedure(expected.signature) AND p.proowner=owner_oid
        AND p.pronamespace=to_regnamespace('public')
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.prior_sha;
    definition:=pg_get_functiondef(actual.oid);
    IF cardinality(string_to_array(definition,actual.prosrc))<>2
      OR cardinality(string_to_array(actual.prosrc,expected.anchor))<>2 THEN
      RAISE EXCEPTION 'SIGNED_SETTLEMENT_FILE_TRIGGER_PREIMAGE' USING ERRCODE='55000';
    END IF;
    successor:=replace(actual.prosrc,expected.anchor,expected.replacement);
    IF encode(sha256(convert_to(successor,'UTF8')),'hex')<>expected.next_sha THEN
      RAISE EXCEPTION 'SIGNED_SETTLEMENT_FILE_TRIGGER_DIGEST' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition,actual.prosrc,successor);
    IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=actual.oid AND p.prosrc=successor
      AND to_jsonb(p)-'prosrc'=actual.metadata) THEN
      RAISE EXCEPTION 'SIGNED_SETTLEMENT_FILE_TRIGGER_POSTIMAGE' USING ERRCODE='55000';
    END IF;
  END LOOP;

  IF public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM (
    SELECT encode(public.digest(convert_to(to_jsonb(bound)::text,'UTF8'),'sha256'),'hex')
    FROM public.jg_contract_direct_upward_closure_v2 bound
  ) THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_FILE_TRIGGER_CLOSURE' USING ERRCODE='55000';
  END IF;
END;
$manifest$;

COMMIT;
