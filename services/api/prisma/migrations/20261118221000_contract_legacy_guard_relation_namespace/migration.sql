-- Pin these legacy invoker triggers to their existing public relations when
-- an archive executor calls them under pg_catalog, pg_temp.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

DO $qualify$
DECLARE
  expected RECORD;
  original RECORD;
  updated_body TEXT;
  definition TEXT;
  referenced_tables CONSTANT TEXT := '((?:FROM|UPDATE) )("(?:Contract|PaymentExecution|Project|ProjectParticipatingCompany|ProjectAffiliateAssignment)")';
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('public."requireActiveProjectParticipatingCompany"()', 'ContractVersion_require_active_participant', 23,
      'ba713bc2f3d6c7faa9390f75fd9f459a7d2bd2791d62a39fa33a97b291f0ccfc',
      '1e5c1ae87f5227d928ce16e58d89334e60edfb3e3fcbb3648dd94893cc3daff6'),
    ('public."lockProjectConstructionEnterpriseFromFormalFact"()', 'ContractVersion_lock_construction_enterprise', 21,
      'e651e3554e2938ebaa2c07578e109b1ad049188d4984820fe3bc017ca1879839',
      'c57288b55b9bac928d32850b0e3171d2089ab1b7f417eb85e7c1282b6d2d90ca')
  ) AS guards(signature, trigger_name, trigger_type, before_sha, after_sha)
  LOOP
    SELECT p.oid, p.prosrc, to_jsonb(p)-'prosrc' AS metadata, to_jsonb(t) AS trigger_metadata
      INTO STRICT original
      FROM pg_proc p
      JOIN pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      JOIN pg_database d ON d.datname=current_database() AND d.datdba=p.proowner
      JOIN pg_trigger t ON t.tgfoid=p.oid AND t.tgrelid='public."ContractVersion"'::regclass
        AND t.tgname=expected.trigger_name AND t.tgtype=expected.trigger_type AND t.tgenabled='O'
        AND NOT (t.tgisinternal OR t.tgdeferrable OR t.tginitdeferred)
        AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
      WHERE p.oid=to_regprocedure(expected.signature) AND p.pronamespace=to_regnamespace('public')
        AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
        AND NOT (p.prosecdef OR p.proisstrict OR p.proretset) AND p.proconfig IS NULL
        AND p.prorettype='pg_catalog.trigger'::regtype
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.before_sha;
    updated_body:=regexp_replace(original.prosrc,referenced_tables,chr(92)||'1public.'||chr(92)||'2','g');
    definition:=pg_get_functiondef(original.oid);
    IF length(updated_body)-length(original.prosrc)<>35
      OR cardinality(string_to_array(definition,original.prosrc))<>2
      OR encode(sha256(convert_to(updated_body,'UTF8')),'hex')<>expected.after_sha THEN
      RAISE EXCEPTION '合同生效守卫的关系限定点不匹配' USING ERRCODE='55000';
    END IF;

    EXECUTE replace(definition,original.prosrc,updated_body);

    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=original.oid
      AND p.prosrc=updated_body AND to_jsonb(p)-'prosrc'=original.metadata)
      OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid=original.oid AND to_jsonb(t)=original.trigger_metadata) THEN
      RAISE EXCEPTION '合同生效守卫的元数据已变化' USING ERRCODE='55000';
    END IF;
  END LOOP;
END;
$qualify$;
COMMIT;
