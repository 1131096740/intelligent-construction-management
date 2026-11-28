-- Fixed finite206/207/209 catalog/ACL installation recipe adapted for the owned F0 fixture.
-- No business data, receipt, session credential or old execution authority is imported.
DO $supply$
DECLARE
  snapshot RECORD;
  review_row RECORD;
  prepare_row RECORD;
  retained_row RECORD;
  relation_id OID;
  recipe RECORD;
  caller OID;
  file_readers OID[];
  app_file_lock_only BOOLEAN;
  routine_id OID;
  recipient RECORD;
  missing_columns TEXT;
  technical_tables CONSTANT REGCLASS[] := ARRAY[
    'public.jg_contract_direct_review_retention_binding_v1'::regclass,
    'public.jg_contract_direct_archive_binding_v1'::regclass,
    'public.jg_contract_direct_archive_retention_binding_v1'::regclass
  ];
  reference_table CONSTANT REGCLASS := 'public."ContractEconomicReviewFileReference"'::regclass;
BEGIN
  WITH expected_migration_prefix(migration_name,checksum) AS (VALUES
__PREFIX213__
), actual_migration_prefix AS (
  SELECT migration_name,checksum FROM public._prisma_migrations
  WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count=1 AND COALESCE(logs,'')=''
), database_identity AS (
  SELECT d.oid, to_regnamespace('public')::oid AS ns, current_user::regrole::oid AS owner,
    to_regrole(current_setting('jg.post213_application_role'))::oid AS app
  FROM pg_database d
  WHERE d.datname=current_database() AND d.datname=current_setting('jg.post213_database_name') AND d.oid::text=current_setting('jg.post213_database_oid')
    AND d.datname~'^jiangkong_project_financing_quota_[a-z0-9_]+$' AND current_user=current_setting('jg.post213_owner_role') AND current_user=session_user
    AND current_setting('transaction_read_only')='off' AND current_setting('session_replication_role')='origin'
    AND current_setting('server_version_num')::int BETWEEN 160000 AND 169999


), pending AS (
  SELECT p.*,p.tableoid AS rel,encode(public.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') AS sha
  FROM public.jg_contract_direct_pending_binding_v1 p
  JOIN database_identity d ON p."databaseOid"=d.oid AND p."anchorNamespaceOid"=d.ns
    AND p."anchorOwnerOid"=d.owner AND p."applicationRoleOid"=d.app
  WHERE p."protocolVersion"=1 AND p."recipeVersion"='contract-direct-pending-input-v1/1'
), review_catalog AS (
      WITH requested_routines AS (SELECT unnest(ARRAY['jg_guard_contract_direct_review_v1','jg_materialize_contract_direct_review_files_v1','jg_guard_contract_direct_review_file_reference_v1','jg_assert_contract_direct_review_files_complete_v1','jg_protect_contract_direct_review_file_v1','protectContractEconomicReview','guard_payment_execution_payer_evidence_immutable','guard_verified_bank_transaction_observation_evidence_immutable','jg_contract_direct_pending_file_guard_v1','jg_enforce_file_replacement_exclusive_binding']::text[]) AS name),
      requested_relations AS (SELECT unnest(ARRAY['jg_contract_direct_review_retention_binding_v1','ContractEconomicReviewFileReference','ContractEconomicReview','FileObject','ContractVersion','Contract','Project']::text[]) AS name),
      relations AS (
        SELECT names.name,c.oid,c.relowner,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl
        FROM requested_relations names LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(pg_catalog.format('public.%I',names.name))
      ), routines AS (
        SELECT names.name,p.oid,p.proowner,p.prosecdef,p.proconfig,p.proacl,p.provolatile,p.prosrc,p.prorettype,p.prolang
        FROM requested_routines names LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(pg_catalog.format('public.%I()',names.name))
      ), reachable AS (
        SELECT r.oid FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(current_user::regrole::oid,r.oid,'MEMBER')
      )
      SELECT pg_catalog.jsonb_build_object(
        'relations', (SELECT pg_catalog.jsonb_object_agg(r.name,pg_catalog.jsonb_build_object(
          'oid',r.oid::text,'owner',r.relowner::text,'kind',r.relkind,'rls',r.relrowsecurity,'forceRls',r.relforcerowsecurity,'acl',r.relacl,
          'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,'type',a.atttypid::text,'notNull',a.attnotnull)
            ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),
          'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('oid',c.oid::text,'name',c.conname,'type',c.contype,
            'definition',pg_catalog.pg_get_constraintdef(c.oid,false),'validated',c.convalidated) ORDER BY c.conname)
            FROM pg_catalog.pg_constraint c WHERE c.conrelid=r.oid)
        )) FROM relations r),
        'routines', (SELECT pg_catalog.jsonb_object_agg(r.name,pg_catalog.jsonb_build_object('oid',r.oid::text,'owner',r.proowner::text,
          'definer',r.prosecdef,'configuration',r.proconfig,'acl',r.proacl,'volatility',r.provolatile,
          'language',l.lanname,'returnType',r.prorettype::text,'sha',pg_catalog.encode(public.digest(pg_catalog.convert_to(r.prosrc,'UTF8'),'sha256'),'hex')))
          FROM routines r LEFT JOIN pg_catalog.pg_language l ON l.oid=r.prolang),
        'triggers', (SELECT pg_catalog.jsonb_object_agg(t.tgname,pg_catalog.jsonb_build_object('oid',t.oid::text,'relation',t.tgrelid::text,
          'routine',t.tgfoid::text,'enabled',t.tgenabled,'type',t.tgtype,'deferred',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred,
          'args',pg_catalog.encode(t.tgargs,'hex'),'columns',ARRAY(SELECT a.attname::text FROM unnest(t.tgattr) WITH ORDINALITY k(num,position)
            JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=k.num ORDER BY k.position),'condition',t.tgqual IS NOT NULL,'internal',t.tgisinternal))
          FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND (
            t.tgfoid IN (SELECT oid FROM routines WHERE name=ANY(ARRAY['jg_guard_contract_direct_review_v1','jg_materialize_contract_direct_review_files_v1','jg_guard_contract_direct_review_file_reference_v1','jg_assert_contract_direct_review_files_complete_v1','jg_protect_contract_direct_review_file_v1']::text[]))
            OR t.tgrelid IN ('public."ContractEconomicReview"'::regclass,'public."ContractEconomicReviewFileReference"'::regclass,'public."FileObject"'::regclass)))) AS bindings
), retention_catalog AS (WITH selected_relations AS (
        SELECT relname,oid FROM pg_catalog.pg_class WHERE oid IN (
          pg_catalog.to_regclass('public.jg_contract_direct_archive_retention_binding_v1'),pg_catalog.to_regclass('public."FileObject"'),
          pg_catalog.to_regclass('public."ContractArchiveFile"'),pg_catalog.to_regclass('public."ContractArchiveEvidenceFile"'))
      ), selected_routines AS (
        SELECT p.*,l.lanname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid IN (
          pg_catalog.to_regprocedure('public.jg_guard_contract_direct_archive_retention_binding_v1()'),
          pg_catalog.to_regprocedure('public.jg_protect_contract_direct_archive_file_v1()'),
          pg_catalog.to_regprocedure('public.jg_require_contract_direct_archive_complete_v1()'),
          pg_catalog.to_regprocedure('public.jg_contract_archive_v2_complete_guard()'),
          pg_catalog.to_regprocedure('public.jg_protect_contract_direct_review_file_v1()'),
          pg_catalog.to_regprocedure('public.jg_contract_direct_archive_proof_v1(pg_catalog.text)'),
          pg_catalog.to_regprocedure('public.jg_contract_direct_archive_request_sha_v1(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.int4,pg_catalog.text,pg_catalog.text[])')
        )
      ), selected_triggers AS (
        SELECT t.* FROM pg_catalog.pg_trigger t WHERE t.tgfoid IN (SELECT oid FROM selected_routines)
          OR (t.tgrelid IN (SELECT oid FROM selected_relations) AND t.tgname IN (
            'jg_direct_archive_retention_binding_immutable','jg_direct_archive_retention_binding_no_truncate',
            'FileObject_contract_direct_archive_retention_v1','ContractArchiveFile_direct_complete_v1','ContractArchiveEvidenceFile_direct_complete_v1',
            'ContractArchiveFile_v2_complete','ContractArchiveEvidenceFile_v2_complete','FileObject_contract_direct_review_retention_v1'))
      ), reachable AS (
        SELECT r.oid,r.rolsuper,r.rolcreaterole,r.rolreplication,r.rolbypassrls FROM pg_catalog.pg_roles r
        WHERE pg_catalog.pg_has_role(current_user::regrole::oid,r.oid,'MEMBER')
      ), file_reads(table_name,column_name) AS (
        VALUES ('public."ContractArchiveFile"','id'),('public."ContractArchiveFile"','contractVersionId'),
          ('public."ContractArchiveFile"','archiveProtocolVersion'),('public."ContractArchiveFile"','archiveSource'),
          ('public."ContractArchiveEvidenceFile"','archiveFileId'),('public."ContractArchiveEvidenceFile"','contractVersionId'),
          ('public."ContractArchiveEvidenceFile"','fileId'),('public."FileObject"','id'),('public."FileObject"','objectKey'),
          ('public."ContractEconomicReviewFileReference"','fileId'),('public."ContractEconomicReviewFileReference"','objectKey')
      ), completion_reads(table_name,column_name) AS (
        SELECT table_name,column_name FROM file_reads UNION ALL VALUES
          ('public."ContractArchiveFile"','confirmedAt'),('public."ContractArchiveFile"','authoritySnapshot'),
          ('public."ContractVersion"','id'),('public."ContractVersion"','contractId'),
          ('public."ContractVersion"','affiliateAssignmentId'),('public."ContractVersion"','affiliateBusinessPartyVersionId'),
          ('public."Contract"','id'),('public."Contract"','projectId'),
          ('public."Project"','id'),('public."Project"','isActive'),('public."Project"','operatingLedgerEffectiveDate'),
          ('public."ProjectAffiliateAssignment"','id'),('public."ProjectAffiliateAssignment"','projectId'),
          ('public."ProjectAffiliateAssignment"','effectiveFrom'),('public."ProjectAffiliateAssignment"','endedAt'),
          ('public."ProjectAffiliateAssignment"','businessPartyVersionId'),('public."ProjectAffiliateAssignment"','businessPartyId'),
          ('public."OperatingFact"','sourceType'),('public."OperatingFact"','sourceBusinessId'),
          ('public."OperatingImpactEntry"','sourceType'),('public."OperatingImpactEntry"','sourceBusinessId')
      )
 SELECT jsonb_build_object(
          'relations',(SELECT jsonb_object_agg(relname,oid::text) FROM selected_relations),
          'routines',(SELECT jsonb_object_agg(proname,jsonb_build_object(
            'oid',oid::text,'owner',proowner::text,'namespace',pronamespace::text,
            'sha',encode(public.digest(convert_to(prosrc,'UTF8'),'sha256'),'hex'),
            'language',lanname,'returnType',prorettype::text,'volatility',provolatile,'parallel',proparallel,
            'securityDefiner',prosecdef,'strict',proisstrict,'returnsSet',proretset,'configuration',proconfig,'acl',proacl,
            'noPublicExecute',NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) acl WHERE acl.grantee=0)
          )) FROM selected_routines),
          'triggers',(SELECT jsonb_object_agg(tgname,jsonb_build_object(
            'oid',t.oid::text,'relation',t.tgrelid::text,'routine',t.tgfoid::text,'type',t.tgtype,'enabled',t.tgenabled,
            'deferred',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred,'condition',t.tgqual IS NOT NULL,'internal',t.tgisinternal,
            'args',encode(t.tgargs,'hex'),'columns',ARRAY(SELECT a.attname::text FROM unnest(t.tgattr) WITH ORDINALITY k(num,pos)
              JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=k.num ORDER BY k.pos)
          )) FROM selected_triggers t)
        ) AS bindings
), review_recipe(name,sha) AS (VALUES
    ('jg_guard_contract_direct_review_v1','20b307255fb78bd08df03d01708bbb2bf6a8e9660305b15cb24f6acc29a9999c'),
    ('jg_materialize_contract_direct_review_files_v1','a8b0f5183bbd92fa7362cf5fea5f7b0aff48ad1e366fd1fdc8ca04e7903ce132'),
    ('jg_guard_contract_direct_review_file_reference_v1','0a637030b274eca9cb609a92549c700946b177befb48e40edac4057b0923e8fd'),
    ('jg_assert_contract_direct_review_files_complete_v1','dc962c2e969636957e011f11b669e84b7b08096900e0cb03f41cb215eb958b63'),
    ('jg_protect_contract_direct_review_file_v1','6721a2e5a938aa46cba7a56d2f811eed6d09ce2db2765af44d83fcc1905dfa20'),
    ('protectContractEconomicReview','e31b5ffda24ec9aea17ea49716b517355f87b5f9b6c70d31fcb61b383b3b91b1'),
    ('guard_payment_execution_payer_evidence_immutable','cf2f8fd6a49b3cac5fef5e397ebe3f6745455cdd898bdea56b9d7879bbad0f20'),
    ('guard_verified_bank_transaction_observation_evidence_immutable','1d99af05f59b13e9b0d5e2fddf8ff2d79b201352b2175f5e4f58920bfdd031f1'),
    ('jg_contract_direct_pending_file_guard_v1','106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1'),
    ('jg_enforce_file_replacement_exclusive_binding','4c91d71432a110f0b491bb04da4c1f0a0e5d53d7116f5ef1e4f3e2ca7f839bda')
), retention_recipe(name,sha) AS (VALUES
    ('jg_guard_contract_direct_archive_retention_binding_v1','167157e946edc0539ce6136797ac9a1787bb02239bf06997f8b65a85ed161391'),
    ('jg_protect_contract_direct_archive_file_v1','8c6801d789cdf60419d6e5d2239110197f164dabab444ef96f2e50c8ec88e40b'),
    ('jg_require_contract_direct_archive_complete_v1','326ba01217db8a85b777ea5f416fbaf3515d4fa49c9eb3d65d4b895760bae6d5'),
    ('jg_protect_contract_direct_review_file_v1','6721a2e5a938aa46cba7a56d2f811eed6d09ce2db2765af44d83fcc1905dfa20'),
    ('jg_contract_archive_v2_complete_guard','4f6b00903b08ac6c1b42bb0feea706271c34a4d2c1f27d9669f8da7b9420a329'),
    ('jg_contract_direct_archive_proof_v1','4c24e5aa811a8b9c98897377987dd59e4baf3d4d6cf323f049eac77c68a8b00f'),
    ('jg_contract_direct_archive_request_sha_v1','f3e329de50e81169c974f55e6c0a965237372f47c2af950c12c8e1d406294cbf')
)
SELECT p."databaseOid" AS database_oid,
  p."anchorOwnerOid" AS owner_oid, p."anchorNamespaceOid" AS namespace_oid,
  p."applicationRoleOid" AS application_oid, p."fileCallerOids" AS file_caller_oids,
  p.rel AS pending_relation_oid, p.sha AS pending_sha,
  jsonb_set(r.bindings,'{triggers}',(r.bindings->'triggers')-'FileObject_contract_direct_archive_retention_v1') AS review_bindings,
  t.bindings AS retention_bindings
INTO STRICT snapshot
FROM pending p CROSS JOIN review_catalog r CROSS JOIN retention_catalog t
WHERE (SELECT count(*)=213 FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
  AND (SELECT count(*)=213 FROM actual_migration_prefix)
  AND NOT EXISTS(SELECT * FROM expected_migration_prefix EXCEPT SELECT * FROM actual_migration_prefix)
  AND NOT EXISTS(SELECT * FROM actual_migration_prefix EXCEPT SELECT * FROM expected_migration_prefix)
  AND NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_review_retention_binding_v1)
  AND NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_binding_v1)
  AND NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_retention_binding_v1)
  AND NOT EXISTS(SELECT 1 FROM review_recipe q WHERE r.bindings#>>ARRAY['routines',q.name,'sha'] IS DISTINCT FROM q.sha)
  AND NOT EXISTS(SELECT 1 FROM retention_recipe q WHERE t.bindings#>>ARRAY['routines',q.name,'sha'] IS DISTINCT FROM q.sha)
  AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys((r.bindings->'triggers')-'FileObject_contract_direct_archive_retention_v1') q(key))
      =(SELECT array_agg(key ORDER BY key) FROM unnest(ARRAY['ContractEconomicReview_direct_source_guard_v1','ContractEconomicReview_direct_source_files_v1','ContractEconomicReviewFileReference_guard_v1','ContractEconomicReview_direct_source_complete_v1','ContractEconomicReviewFileReference_complete_v1','FileObject_contract_direct_review_retention_v1','ContractEconomicReview_immutable','PaymentExecutionPayerAttestation_evidence_immutable','VerifiedBankTransactionObservation_evidence_immutable','jg_direct_pending_file_retained','jg_efb_file_replacement']::text[]) q(key))
  AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(t.bindings->'triggers') q(key))
      =(SELECT array_agg(key ORDER BY key) FROM unnest(ARRAY['jg_direct_archive_retention_binding_immutable','jg_direct_archive_retention_binding_no_truncate','FileObject_contract_direct_archive_retention_v1','FileObject_contract_direct_review_retention_v1','ContractArchiveFile_direct_complete_v1','ContractArchiveEvidenceFile_direct_complete_v1','ContractArchiveFile_v2_complete','ContractArchiveEvidenceFile_v2_complete']::text[]) q(key))
  AND r.bindings#>'{triggers,FileObject_contract_direct_archive_retention_v1}'
      =t.bindings#>'{triggers,FileObject_contract_direct_archive_retention_v1}';

  IF snapshot.pending_sha IS DISTINCT FROM current_setting('jg.post213_pending_sha256')
    OR NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='public._prisma_migrations'::regclass
      AND c.relowner=snapshot.owner_oid AND c.relnamespace=snapshot.namespace_oid
      AND c.relkind='r' AND NOT (c.relrowsecurity OR c.relforcerowsecurity OR c.relispartition))
    OR NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=snapshot.pending_relation_oid
      AND c.relowner=snapshot.owner_oid AND c.relnamespace=snapshot.namespace_oid
      AND c.relkind='r' AND NOT (c.relrowsecurity OR c.relforcerowsecurity OR c.relispartition))
    OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_trigger t ON t.tgfoid=p.oid
      WHERE p.oid='public.jg_contract_direct_pending_binding_guard_v1()'::regprocedure
        AND p.proowner=snapshot.owner_oid AND p.pronamespace=snapshot.namespace_oid AND NOT p.prosecdef
        AND p.proconfig=ARRAY['search_path=pg_catalog, public']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='5f8c18f1a74e20703d55edc4b2f228972902b8e217c9ba5ce0a07041e4084e8d'
        AND t.tgrelid=snapshot.pending_relation_oid AND t.tgname='jg_direct_pending_binding_immutable'
        AND t.tgenabled='O' AND t.tgtype=31 AND NOT (t.tgisinternal OR t.tgdeferrable OR t.tginitdeferred)
        AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='') THEN
    RAISE EXCEPTION 'POST213_PENDING_LINEAGE_REJECTED' USING ERRCODE='JGD02';
  END IF;

  IF snapshot.application_oid=snapshot.owner_oid OR NOT EXISTS(SELECT 1 FROM pg_roles r
      WHERE r.oid=snapshot.application_oid AND r.rolcanlogin)
    OR NOT has_schema_privilege(snapshot.application_oid,snapshot.namespace_oid,'USAGE')
    OR EXISTS(SELECT 1 FROM pg_roles r WHERE pg_has_role(snapshot.application_oid,r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
        OR pg_has_role(r.oid,snapshot.owner_oid,'MEMBER') OR has_schema_privilege(r.oid,snapshot.namespace_oid,'CREATE')
        OR has_parameter_privilege(r.oid,'session_replication_role','SET')))
    OR cardinality(snapshot.file_caller_oids)=0
    OR cardinality(snapshot.file_caller_oids)<>(SELECT count(DISTINCT f.oid) FROM unnest(snapshot.file_caller_oids) f(oid)
      JOIN pg_roles r ON r.oid=f.oid) THEN
    RAISE EXCEPTION 'POST213_ROLE_REJECTED' USING ERRCODE='JGD03';
  END IF;

  -- The sealed Schema205 fixture names its owner and application. File
  -- recipients come only from the already bound, independently hashed row.
  IF current_user <> 'jiangkong'
    OR current_setting('jg.post213_application_role') <> __APP_LITERAL__
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE oid='pg_read_all_data'::regrole::oid AND rolname='pg_read_all_data'
      AND NOT (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE oid='pg_write_all_data'::regrole::oid AND rolname='pg_write_all_data'
      AND NOT (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid IN ('pg_read_all_data'::regrole::oid,'pg_write_all_data'::regrole::oid)
      OR roleid=ANY(snapshot.file_caller_oids||ARRAY[snapshot.application_oid]::oid[]))
    OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner IN ('pg_read_all_data'::regrole::oid,'pg_write_all_data'::regrole::oid) AND prosecdef)
    OR EXISTS (SELECT 1 FROM unnest(snapshot.file_caller_oids) f(oid)
      JOIN pg_roles r ON r.oid=f.oid WHERE r.oid<>snapshot.owner_oid
      AND (r.oid IN ('pg_read_all_data'::regrole::oid,'pg_write_all_data'::regrole::oid) OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
        OR r.rolbypassrls OR pg_has_role(r.oid,snapshot.owner_oid,'MEMBER')
        OR has_schema_privilege(r.oid,snapshot.namespace_oid,'CREATE')
        OR has_parameter_privilege(r.oid,'session_replication_role','SET'))) THEN
    RAISE EXCEPTION 'POST213_ROLE_CLOSURE_REJECTED' USING ERRCODE='JGD04';
  END IF;

  FOREACH relation_id IN ARRAY technical_tables LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=relation_id AND c.relowner=snapshot.owner_oid
        AND c.relnamespace=snapshot.namespace_oid AND c.relkind='r' AND c.relpersistence='p'
        AND NOT (c.relispartition OR c.relrowsecurity OR c.relforcerowsecurity))
      OR EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid=relation_id
        AND (a.grantor<>snapshot.owner_oid OR a.grantee<>snapshot.owner_oid
          AND (a.grantee<>snapshot.application_oid OR a.privilege_type<>'SELECT' OR a.is_grantable)))
      OR EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=relation_id AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
      OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid<>snapshot.owner_oid AND NOT r.rolsuper AND r.oid<>'pg_write_all_data'::regrole::oid
        AND (has_table_privilege(r.oid,relation_id,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,SELECT WITH GRANT OPTION')
          OR has_any_column_privilege(r.oid,relation_id,'INSERT,UPDATE,REFERENCES,SELECT WITH GRANT OPTION'))) THEN
      RAISE EXCEPTION 'POST213_WITNESS_ACL_REJECTED' USING ERRCODE='JGD05';
    END IF;
  END LOOP;

  FOR recipe IN SELECT * FROM (VALUES
    (technical_tables[2], 'public.jg_contract_direct_archive_binding_guard_v1()', '88713aea758f69f6a42d6bd1329cdeeab386f1e535ac1dc69a59e3eac24f93a3',
      'jg_direct_archive_binding_immutable', 'jg_direct_archive_binding_no_truncate'),
    (technical_tables[3], 'public.jg_guard_contract_direct_archive_retention_binding_v1()', '167157e946edc0539ce6136797ac9a1787bb02239bf06997f8b65a85ed161391',
      'jg_direct_archive_retention_binding_immutable', 'jg_direct_archive_retention_binding_no_truncate')
  ) guards(target,signature,body_sha,row_hook,truncate_hook) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(recipe.signature)
      AND p.proowner=snapshot.owner_oid AND p.pronamespace=snapshot.namespace_oid AND NOT p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND p.prorettype='pg_catalog.trigger'::regtype AND p.provolatile='v' AND p.proparallel='u'
      AND NOT (p.proisstrict OR p.proretset)
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=recipe.body_sha
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee<>snapshot.owner_oid OR a.grantor<>snapshot.owner_oid)
      AND 2=(SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=recipe.target OR t.tgfoid=p.oid)
      AND 2=(SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=recipe.target AND t.tgfoid=p.oid
        AND t.tgenabled='O' AND NOT (t.tgisinternal OR t.tgdeferrable OR t.tginitdeferred)
        AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
        AND ((t.tgname=recipe.row_hook AND t.tgtype=31) OR (t.tgname=recipe.truncate_hook AND t.tgtype=34)))) THEN
      RAISE EXCEPTION 'POST213_BINDING_GUARD_REJECTED' USING ERRCODE='JGD06';
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM jsonb_each(snapshot.review_bindings->'relations') rel
      WHERE rel.value->>'oid' IS NULL OR rel.value->>'kind' IS DISTINCT FROM 'r'
        OR rel.value->'rls' IS DISTINCT FROM 'false'::jsonb OR rel.value->'forceRls' IS DISTINCT FROM 'false'::jsonb)
    OR EXISTS (SELECT 1 FROM (
      SELECT value FROM jsonb_each(snapshot.review_bindings->'triggers')
      UNION ALL SELECT value FROM jsonb_each(snapshot.retention_bindings->'triggers')
    ) hook WHERE hook.value->>'enabled' IS DISTINCT FROM 'O'
      OR hook.value->'internal' IS DISTINCT FROM 'false'::jsonb
      OR hook.value->'condition' IS DISTINCT FROM 'false'::jsonb)
    OR EXISTS (SELECT 1 FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee=0 AND a.privilege_type='EXECUTE'
        AND (p.oid::text IN (SELECT f.value->>'oid' FROM jsonb_each(snapshot.retention_bindings->'routines') f)
          OR p.oid IN ('public.jg_guard_contract_direct_review_v1()'::regprocedure,
            'public.jg_materialize_contract_direct_review_files_v1()'::regprocedure,
            'public.jg_guard_contract_direct_review_file_reference_v1()'::regprocedure,
            'public.jg_assert_contract_direct_review_files_complete_v1()'::regprocedure))) THEN
    RAISE EXCEPTION 'POST213_CATALOG_REJECTED' USING ERRCODE='JGD07';
  END IF;

  -- The frozen app holds only the previously approved FileObject row-lock
  -- column. That does not make it an old file-collision trigger invoker.
  SELECT EXISTS(
    -- POST213_APP_LOCK_SCOPE_BEGIN
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_roles app ON app.oid=snapshot.application_oid
    JOIN pg_catalog.pg_attribute lock_column ON lock_column.attrelid=c.oid
      AND lock_column.attname='createdAt' AND lock_column.attnum>0 AND NOT lock_column.attisdropped
    JOIN pg_catalog.pg_attribute replacement ON replacement.attrelid=c.oid
      AND replacement.attname='supersedesFileObjectId' AND replacement.attnum>0 AND NOT replacement.attisdropped
    WHERE c.oid='public."FileObject"'::regclass AND c.relowner=snapshot.owner_oid AND c.relnamespace=snapshot.namespace_oid
      AND c.relkind='r' AND c.relpersistence='p' AND NOT (c.relispartition OR c.relrowsecurity OR c.relforcerowsecurity)
      AND app.rolname=__APP_LITERAL__ AND app.rolcanlogin AND app.rolconnlimit=0
      AND NOT (app.rolsuper OR app.rolinherit OR app.rolcreaterole OR app.rolcreatedb OR app.rolreplication OR app.rolbypassrls)
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE app.oid IN (m.member,m.roleid))
      AND NOT pg_catalog.has_table_privilege(app.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT pg_catalog.has_any_column_privilege(app.oid,c.oid,'INSERT,REFERENCES')
      AND NOT pg_catalog.has_any_column_privilege(app.oid,c.oid,'UPDATE WITH GRANT OPTION')
      AND pg_catalog.has_column_privilege(app.oid,c.oid,lock_column.attnum,'UPDATE')
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid
        AND a.attnum>0 AND NOT a.attisdropped AND a.attnum<>lock_column.attnum
        AND pg_catalog.has_column_privilege(app.oid,c.oid,a.attnum,'UPDATE'))
      AND EXISTS(SELECT 1 FROM pg_catalog.aclexplode(lock_column.attacl) grant_row
        WHERE grant_row.grantor=c.relowner AND grant_row.grantee=app.oid
          AND grant_row.privilege_type='UPDATE' AND NOT grant_row.is_grantable)
      AND EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='jg_efb_file_replacement'
        AND t.tgfoid='public.jg_enforce_file_replacement_exclusive_binding()'::regprocedure
        AND t.tgtype=23 AND t.tgenabled='O' AND NOT t.tgisinternal
        AND cardinality(t.tgattr::smallint[])=1 AND replacement.attnum=ANY(t.tgattr::smallint[]))
    -- POST213_APP_LOCK_SCOPE_END
  ) INTO app_file_lock_only;
  IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=reference_table AND c.relowner=snapshot.owner_oid
      AND c.relnamespace=snapshot.namespace_oid AND c.relkind='r' AND NOT (c.relrowsecurity OR c.relforcerowsecurity))
    OR EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid=reference_table AND (a.grantee<>snapshot.owner_oid OR a.grantor<>snapshot.owner_oid))
    OR EXISTS(SELECT 1 FROM pg_attribute col CROSS JOIN LATERAL aclexplode(col.attacl) a
      WHERE col.attrelid=reference_table AND col.attnum>0 AND NOT col.attisdropped
        AND (a.grantor<>snapshot.owner_oid OR a.grantee<>snapshot.owner_oid AND
          (col.attname NOT IN ('fileId','objectKey') OR a.is_grantable OR a.privilege_type<>'SELECT'
            OR NOT (a.grantee=ANY(snapshot.file_caller_oids) OR a.grantee=snapshot.application_oid))))
    OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid<>snapshot.owner_oid AND NOT r.rolsuper AND r.oid<>'pg_write_all_data'::regrole::oid
      AND (has_table_privilege(r.oid,reference_table,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,SELECT WITH GRANT OPTION')
        OR has_any_column_privilege(r.oid,reference_table,'INSERT,UPDATE,REFERENCES,SELECT WITH GRANT OPTION')))
    OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid<>snapshot.owner_oid AND NOT r.rolsuper AND r.oid<>'pg_write_all_data'::regrole::oid
      AND (has_table_privilege(r.oid,'public."FileObject"'::regclass,'INSERT,UPDATE,DELETE')
        OR has_any_column_privilege(r.oid,'public."FileObject"'::regclass,'INSERT,UPDATE'))
      AND r.oid<>snapshot.application_oid
      AND NOT r.oid=ANY(snapshot.file_caller_oids))
    OR NOT app_file_lock_only THEN
    RAISE EXCEPTION 'POST213_FILE_ROLE_SCOPE_REJECTED' USING ERRCODE='JGD08';
  END IF;

  file_readers := ARRAY(SELECT DISTINCT oid FROM
    unnest(snapshot.file_caller_oids||ARRAY[snapshot.application_oid]::oid[]) f(oid) ORDER BY oid);
  -- The supplier contract requires whole-row SELECT on the three immutable
  -- technical witnesses, and column ACLs are forbidden on those tables.
  FOREACH relation_id IN ARRAY technical_tables LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid=relation_id AND a.grantor=snapshot.owner_oid AND a.grantee=snapshot.application_oid
        AND a.privilege_type='SELECT' AND NOT a.is_grantable) THEN
      EXECUTE format('GRANT SELECT ON TABLE %s TO %I',relation_id::regclass,current_setting('jg.post213_application_role'));
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid=relation_id AND a.grantor=snapshot.owner_oid AND a.grantee=snapshot.application_oid
        AND a.privilege_type='SELECT' AND NOT a.is_grantable) THEN
      RAISE EXCEPTION 'POST213_WITNESS_GRANT_REJECTED' USING ERRCODE='JGD09';
    END IF;
  END LOOP;

  -- Only columns actually selected by 206/208/209. A right already effective
  -- through the qualified preimage does not receive another direct grant.
  FOR recipe IN SELECT * FROM (VALUES
    ('ContractArchiveFile',ARRAY['id','contractVersionId','archiveProtocolVersion','archiveSource'],file_readers),
    ('ContractArchiveEvidenceFile',ARRAY['archiveFileId','contractVersionId','fileId'],file_readers),
    ('FileObject',ARRAY['id','objectKey'],file_readers),
    ('ContractEconomicReviewFileReference',ARRAY['fileId','objectKey'],file_readers),
    ('ContractArchiveFile',ARRAY['id','contractVersionId','archiveProtocolVersion','archiveSource','status','fileId',
      'uploadedByUserId','confirmedByUserId','confirmedAt','idempotencyKey','requestSha256','sourceRevision',
      'approvalInstanceId','sealTaskId','documentContentRevision','documentContentFingerprint',
      'authoritySnapshot','authoritySha256','fileManifestSha256','responseSnapshot'],ARRAY[snapshot.application_oid]),
    ('ContractVersion',ARRAY['id','contractId','versionNo','numericProtocolVersion','changeType','supersedesVersionId',
      'status','effectiveAt','taxFactsFrozenAt','firstSubmittedAt','endedAt','signingSubjectType','draftRevision',
      'documentContentFingerprint','originalSignedNumber','affiliateAssignmentId','affiliateBusinessPartyVersionId','draftData'],
      ARRAY[snapshot.application_oid]),
    ('Contract',ARRAY['id','projectId'],ARRAY[snapshot.application_oid]),
    ('Project',ARRAY['id','isActive','operatingLedgerEffectiveDate'],ARRAY[snapshot.application_oid]),
    ('ProjectAffiliateAssignment',ARRAY['id','projectId','effectiveFrom','endedAt','businessPartyVersionId','businessPartyId'],
      ARRAY[snapshot.application_oid]),
    ('OperatingFact',ARRAY['sourceType','sourceBusinessId'],ARRAY[snapshot.application_oid]),
    ('OperatingImpactEntry',ARRAY['sourceType','sourceBusinessId'],ARRAY[snapshot.application_oid]),
    ('PaymentTermsVersion',ARRAY['id','contractId','contractVersionId','status','versionNo','originalText'],
      ARRAY[snapshot.application_oid]),
    ('PaymentTermsStage',ARRAY['paymentTermsVersionId'],ARRAY[snapshot.application_oid]),
    ('ContractArchiveEvidenceFile',ARRAY['archiveFileId','contractVersionId','fileId','displayOrder','mimeType','sizeBytes','contentSha256'],
      ARRAY[snapshot.application_oid]),
    ('FileObject',ARRAY['id','storageStatus','purgeReceiptId','supersedesFileObjectId','mimeType','sizeBytes','contentSha256'],
      ARRAY[snapshot.application_oid]),
    ('ContractDraftAttachment',ARRAY['contractVersionId','slotKey'],ARRAY[snapshot.application_oid])
  ) expected(table_name,cols,recipients) LOOP
    SELECT c.oid INTO STRICT relation_id FROM pg_class c
      WHERE c.oid=to_regclass(format('public.%I',recipe.table_name))
        AND c.relowner=snapshot.owner_oid AND c.relnamespace=snapshot.namespace_oid
        AND c.relkind='r' AND c.relpersistence='p' AND NOT (c.relispartition OR c.relrowsecurity OR c.relforcerowsecurity);
    IF EXISTS (SELECT 1 FROM unnest(recipe.cols) v(name) WHERE NOT EXISTS(
      SELECT 1 FROM pg_attribute a WHERE a.attrelid=relation_id AND a.attname::text=v.name
        AND a.attnum>0 AND NOT a.attisdropped)) THEN
      RAISE EXCEPTION 'POST213_COLUMN_SHAPE_REJECTED' USING ERRCODE='JGD10';
    END IF;
    FOR recipient IN SELECT oid,rolname FROM pg_roles
      WHERE oid=ANY(recipe.recipients) AND oid<>snapshot.owner_oid ORDER BY oid LOOP
      SELECT string_agg(format('%I',v.name),', ' ORDER BY v.name COLLATE "C") INTO missing_columns
        FROM unnest(recipe.cols) v(name)
        WHERE has_column_privilege(recipient.oid,relation_id,v.name,'SELECT') IS DISTINCT FROM TRUE;
      IF missing_columns IS NOT NULL THEN
        EXECUTE format('GRANT SELECT (%s) ON TABLE public.%I TO %I',missing_columns,recipe.table_name,recipient.rolname);
      END IF;
      IF EXISTS (SELECT 1 FROM unnest(recipe.cols) v(name)
        WHERE has_column_privilege(recipient.oid,relation_id,v.name,'SELECT') IS DISTINCT FROM TRUE) THEN
        RAISE EXCEPTION 'POST213_COLUMN_GRANT_REJECTED' USING ERRCODE='JGD11';
      END IF;
    END LOOP;
  END LOOP;

  FOR recipe IN SELECT * FROM (VALUES
    ('public.jg_protect_contract_direct_review_file_v1()',file_readers),
    ('public.jg_protect_contract_direct_archive_file_v1()',file_readers),
    ('public.jg_require_contract_direct_archive_complete_v1()',ARRAY[snapshot.application_oid]),
    ('public.jg_contract_direct_archive_proof_v1(text)',ARRAY[snapshot.application_oid]),
    ('public.jg_contract_direct_archive_request_sha_v1(text,text,text,text,integer,text,text[])',ARRAY[snapshot.application_oid])
  ) expected(signature,recipients) LOOP
    SELECT p.oid INTO STRICT routine_id FROM pg_proc p WHERE p.oid=to_regprocedure(recipe.signature)
      AND p.proowner=snapshot.owner_oid AND p.pronamespace=snapshot.namespace_oid AND NOT p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantor<>snapshot.owner_oid OR (a.grantee<>snapshot.owner_oid
          AND (NOT a.grantee=ANY(recipe.recipients) OR a.is_grantable OR a.privilege_type<>'EXECUTE')));
    FOR recipient IN SELECT oid,rolname FROM pg_roles
      WHERE oid=ANY(recipe.recipients) AND oid<>snapshot.owner_oid ORDER BY oid LOOP
      IF has_function_privilege(recipient.oid,routine_id,'EXECUTE') IS DISTINCT FROM TRUE THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',recipe.signature,recipient.rolname);
      END IF;
      IF has_function_privilege(recipient.oid,routine_id,'EXECUTE') IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'POST213_ROUTINE_GRANT_REJECTED' USING ERRCODE='JGD12';
      END IF;
    END LOOP;
  END LOOP;

  -- Recapture every witness field from actual catalogs after grants.
WITH expected_migration_prefix(migration_name,checksum) AS (VALUES
__PREFIX213__
), actual_migration_prefix AS (
  SELECT migration_name,checksum FROM public._prisma_migrations
  WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count=1 AND COALESCE(logs,'')=''
), database_identity AS (
  SELECT d.oid, to_regnamespace('public')::oid AS ns, current_user::regrole::oid AS owner,
    to_regrole(current_setting('jg.post213_application_role'))::oid AS app
  FROM pg_database d
  WHERE d.datname=current_database() AND d.datname=current_setting('jg.post213_database_name') AND d.oid::text=current_setting('jg.post213_database_oid')
    AND d.datname~'^jiangkong_project_financing_quota_[a-z0-9_]+$' AND current_user=current_setting('jg.post213_owner_role') AND current_user=session_user
    AND current_setting('transaction_read_only')='off' AND current_setting('session_replication_role')='origin'
    AND current_setting('server_version_num')::int BETWEEN 160000 AND 169999


), pending AS (
  SELECT p.*,p.tableoid AS rel,encode(public.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') AS sha
  FROM public.jg_contract_direct_pending_binding_v1 p
  JOIN database_identity d ON p."databaseOid"=d.oid AND p."anchorNamespaceOid"=d.ns
    AND p."anchorOwnerOid"=d.owner AND p."applicationRoleOid"=d.app
  WHERE p."protocolVersion"=1 AND p."recipeVersion"='contract-direct-pending-input-v1/1'
), review_catalog AS (
      WITH requested_routines AS (SELECT unnest(ARRAY['jg_guard_contract_direct_review_v1','jg_materialize_contract_direct_review_files_v1','jg_guard_contract_direct_review_file_reference_v1','jg_assert_contract_direct_review_files_complete_v1','jg_protect_contract_direct_review_file_v1','protectContractEconomicReview','guard_payment_execution_payer_evidence_immutable','guard_verified_bank_transaction_observation_evidence_immutable','jg_contract_direct_pending_file_guard_v1','jg_enforce_file_replacement_exclusive_binding']::text[]) AS name),
      requested_relations AS (SELECT unnest(ARRAY['jg_contract_direct_review_retention_binding_v1','ContractEconomicReviewFileReference','ContractEconomicReview','FileObject','ContractVersion','Contract','Project']::text[]) AS name),
      relations AS (
        SELECT names.name,c.oid,c.relowner,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl
        FROM requested_relations names LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(pg_catalog.format('public.%I',names.name))
      ), routines AS (
        SELECT names.name,p.oid,p.proowner,p.prosecdef,p.proconfig,p.proacl,p.provolatile,p.prosrc,p.prorettype,p.prolang
        FROM requested_routines names LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(pg_catalog.format('public.%I()',names.name))
      ), reachable AS (
        SELECT r.oid FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(current_user::regrole::oid,r.oid,'MEMBER')
      )
      SELECT pg_catalog.jsonb_build_object(
        'relations', (SELECT pg_catalog.jsonb_object_agg(r.name,pg_catalog.jsonb_build_object(
          'oid',r.oid::text,'owner',r.relowner::text,'kind',r.relkind,'rls',r.relrowsecurity,'forceRls',r.relforcerowsecurity,'acl',r.relacl,
          'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,'type',a.atttypid::text,'notNull',a.attnotnull)
            ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),
          'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('oid',c.oid::text,'name',c.conname,'type',c.contype,
            'definition',pg_catalog.pg_get_constraintdef(c.oid,false),'validated',c.convalidated) ORDER BY c.conname)
            FROM pg_catalog.pg_constraint c WHERE c.conrelid=r.oid)
        )) FROM relations r),
        'routines', (SELECT pg_catalog.jsonb_object_agg(r.name,pg_catalog.jsonb_build_object('oid',r.oid::text,'owner',r.proowner::text,
          'definer',r.prosecdef,'configuration',r.proconfig,'acl',r.proacl,'volatility',r.provolatile,
          'language',l.lanname,'returnType',r.prorettype::text,'sha',pg_catalog.encode(public.digest(pg_catalog.convert_to(r.prosrc,'UTF8'),'sha256'),'hex')))
          FROM routines r LEFT JOIN pg_catalog.pg_language l ON l.oid=r.prolang),
        'triggers', (SELECT pg_catalog.jsonb_object_agg(t.tgname,pg_catalog.jsonb_build_object('oid',t.oid::text,'relation',t.tgrelid::text,
          'routine',t.tgfoid::text,'enabled',t.tgenabled,'type',t.tgtype,'deferred',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred,
          'args',pg_catalog.encode(t.tgargs,'hex'),'columns',ARRAY(SELECT a.attname::text FROM unnest(t.tgattr) WITH ORDINALITY k(num,position)
            JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=k.num ORDER BY k.position),'condition',t.tgqual IS NOT NULL,'internal',t.tgisinternal))
          FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND (
            t.tgfoid IN (SELECT oid FROM routines WHERE name=ANY(ARRAY['jg_guard_contract_direct_review_v1','jg_materialize_contract_direct_review_files_v1','jg_guard_contract_direct_review_file_reference_v1','jg_assert_contract_direct_review_files_complete_v1','jg_protect_contract_direct_review_file_v1']::text[]))
            OR t.tgrelid IN ('public."ContractEconomicReview"'::regclass,'public."ContractEconomicReviewFileReference"'::regclass,'public."FileObject"'::regclass)))) AS bindings
), retention_catalog AS (WITH selected_relations AS (
        SELECT relname,oid FROM pg_catalog.pg_class WHERE oid IN (
          pg_catalog.to_regclass('public.jg_contract_direct_archive_retention_binding_v1'),pg_catalog.to_regclass('public."FileObject"'),
          pg_catalog.to_regclass('public."ContractArchiveFile"'),pg_catalog.to_regclass('public."ContractArchiveEvidenceFile"'))
      ), selected_routines AS (
        SELECT p.*,l.lanname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid IN (
          pg_catalog.to_regprocedure('public.jg_guard_contract_direct_archive_retention_binding_v1()'),
          pg_catalog.to_regprocedure('public.jg_protect_contract_direct_archive_file_v1()'),
          pg_catalog.to_regprocedure('public.jg_require_contract_direct_archive_complete_v1()'),
          pg_catalog.to_regprocedure('public.jg_contract_archive_v2_complete_guard()'),
          pg_catalog.to_regprocedure('public.jg_protect_contract_direct_review_file_v1()'),
          pg_catalog.to_regprocedure('public.jg_contract_direct_archive_proof_v1(pg_catalog.text)'),
          pg_catalog.to_regprocedure('public.jg_contract_direct_archive_request_sha_v1(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.int4,pg_catalog.text,pg_catalog.text[])')
        )
      ), selected_triggers AS (
        SELECT t.* FROM pg_catalog.pg_trigger t WHERE t.tgfoid IN (SELECT oid FROM selected_routines)
          OR (t.tgrelid IN (SELECT oid FROM selected_relations) AND t.tgname IN (
            'jg_direct_archive_retention_binding_immutable','jg_direct_archive_retention_binding_no_truncate',
            'FileObject_contract_direct_archive_retention_v1','ContractArchiveFile_direct_complete_v1','ContractArchiveEvidenceFile_direct_complete_v1',
            'ContractArchiveFile_v2_complete','ContractArchiveEvidenceFile_v2_complete','FileObject_contract_direct_review_retention_v1'))
      ), reachable AS (
        SELECT r.oid,r.rolsuper,r.rolcreaterole,r.rolreplication,r.rolbypassrls FROM pg_catalog.pg_roles r
        WHERE pg_catalog.pg_has_role(current_user::regrole::oid,r.oid,'MEMBER')
      ), file_reads(table_name,column_name) AS (
        VALUES ('public."ContractArchiveFile"','id'),('public."ContractArchiveFile"','contractVersionId'),
          ('public."ContractArchiveFile"','archiveProtocolVersion'),('public."ContractArchiveFile"','archiveSource'),
          ('public."ContractArchiveEvidenceFile"','archiveFileId'),('public."ContractArchiveEvidenceFile"','contractVersionId'),
          ('public."ContractArchiveEvidenceFile"','fileId'),('public."FileObject"','id'),('public."FileObject"','objectKey'),
          ('public."ContractEconomicReviewFileReference"','fileId'),('public."ContractEconomicReviewFileReference"','objectKey')
      ), completion_reads(table_name,column_name) AS (
        SELECT table_name,column_name FROM file_reads UNION ALL VALUES
          ('public."ContractArchiveFile"','confirmedAt'),('public."ContractArchiveFile"','authoritySnapshot'),
          ('public."ContractVersion"','id'),('public."ContractVersion"','contractId'),
          ('public."ContractVersion"','affiliateAssignmentId'),('public."ContractVersion"','affiliateBusinessPartyVersionId'),
          ('public."Contract"','id'),('public."Contract"','projectId'),
          ('public."Project"','id'),('public."Project"','isActive'),('public."Project"','operatingLedgerEffectiveDate'),
          ('public."ProjectAffiliateAssignment"','id'),('public."ProjectAffiliateAssignment"','projectId'),
          ('public."ProjectAffiliateAssignment"','effectiveFrom'),('public."ProjectAffiliateAssignment"','endedAt'),
          ('public."ProjectAffiliateAssignment"','businessPartyVersionId'),('public."ProjectAffiliateAssignment"','businessPartyId'),
          ('public."OperatingFact"','sourceType'),('public."OperatingFact"','sourceBusinessId'),
          ('public."OperatingImpactEntry"','sourceType'),('public."OperatingImpactEntry"','sourceBusinessId')
      )
 SELECT jsonb_build_object(
          'relations',(SELECT jsonb_object_agg(relname,oid::text) FROM selected_relations),
          'routines',(SELECT jsonb_object_agg(proname,jsonb_build_object(
            'oid',oid::text,'owner',proowner::text,'namespace',pronamespace::text,
            'sha',encode(public.digest(convert_to(prosrc,'UTF8'),'sha256'),'hex'),
            'language',lanname,'returnType',prorettype::text,'volatility',provolatile,'parallel',proparallel,
            'securityDefiner',prosecdef,'strict',proisstrict,'returnsSet',proretset,'configuration',proconfig,'acl',proacl,
            'noPublicExecute',NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) acl WHERE acl.grantee=0)
          )) FROM selected_routines),
          'triggers',(SELECT jsonb_object_agg(tgname,jsonb_build_object(
            'oid',t.oid::text,'relation',t.tgrelid::text,'routine',t.tgfoid::text,'type',t.tgtype,'enabled',t.tgenabled,
            'deferred',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred,'condition',t.tgqual IS NOT NULL,'internal',t.tgisinternal,
            'args',encode(t.tgargs,'hex'),'columns',ARRAY(SELECT a.attname::text FROM unnest(t.tgattr) WITH ORDINALITY k(num,pos)
              JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=k.num ORDER BY k.pos)
          )) FROM selected_triggers t)
        ) AS bindings
), review_recipe(name,sha) AS (VALUES
    ('jg_guard_contract_direct_review_v1','20b307255fb78bd08df03d01708bbb2bf6a8e9660305b15cb24f6acc29a9999c'),
    ('jg_materialize_contract_direct_review_files_v1','a8b0f5183bbd92fa7362cf5fea5f7b0aff48ad1e366fd1fdc8ca04e7903ce132'),
    ('jg_guard_contract_direct_review_file_reference_v1','0a637030b274eca9cb609a92549c700946b177befb48e40edac4057b0923e8fd'),
    ('jg_assert_contract_direct_review_files_complete_v1','dc962c2e969636957e011f11b669e84b7b08096900e0cb03f41cb215eb958b63'),
    ('jg_protect_contract_direct_review_file_v1','6721a2e5a938aa46cba7a56d2f811eed6d09ce2db2765af44d83fcc1905dfa20'),
    ('protectContractEconomicReview','e31b5ffda24ec9aea17ea49716b517355f87b5f9b6c70d31fcb61b383b3b91b1'),
    ('guard_payment_execution_payer_evidence_immutable','cf2f8fd6a49b3cac5fef5e397ebe3f6745455cdd898bdea56b9d7879bbad0f20'),
    ('guard_verified_bank_transaction_observation_evidence_immutable','1d99af05f59b13e9b0d5e2fddf8ff2d79b201352b2175f5e4f58920bfdd031f1'),
    ('jg_contract_direct_pending_file_guard_v1','106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1'),
    ('jg_enforce_file_replacement_exclusive_binding','4c91d71432a110f0b491bb04da4c1f0a0e5d53d7116f5ef1e4f3e2ca7f839bda')
), retention_recipe(name,sha) AS (VALUES
    ('jg_guard_contract_direct_archive_retention_binding_v1','167157e946edc0539ce6136797ac9a1787bb02239bf06997f8b65a85ed161391'),
    ('jg_protect_contract_direct_archive_file_v1','8c6801d789cdf60419d6e5d2239110197f164dabab444ef96f2e50c8ec88e40b'),
    ('jg_require_contract_direct_archive_complete_v1','326ba01217db8a85b777ea5f416fbaf3515d4fa49c9eb3d65d4b895760bae6d5'),
    ('jg_protect_contract_direct_review_file_v1','6721a2e5a938aa46cba7a56d2f811eed6d09ce2db2765af44d83fcc1905dfa20'),
    ('jg_contract_archive_v2_complete_guard','4f6b00903b08ac6c1b42bb0feea706271c34a4d2c1f27d9669f8da7b9420a329'),
    ('jg_contract_direct_archive_proof_v1','4c24e5aa811a8b9c98897377987dd59e4baf3d4d6cf323f049eac77c68a8b00f'),
    ('jg_contract_direct_archive_request_sha_v1','f3e329de50e81169c974f55e6c0a965237372f47c2af950c12c8e1d406294cbf')
)
SELECT p."databaseOid" AS database_oid,
  p."anchorOwnerOid" AS owner_oid, p."anchorNamespaceOid" AS namespace_oid,
  p."applicationRoleOid" AS application_oid, p."fileCallerOids" AS file_caller_oids,
  p.rel AS pending_relation_oid, p.sha AS pending_sha,
  jsonb_set(r.bindings,'{triggers}',(r.bindings->'triggers')-'FileObject_contract_direct_archive_retention_v1') AS review_bindings,
  t.bindings AS retention_bindings
INTO STRICT snapshot
FROM pending p CROSS JOIN review_catalog r CROSS JOIN retention_catalog t
WHERE (SELECT count(*)=213 FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
  AND (SELECT count(*)=213 FROM actual_migration_prefix)
  AND NOT EXISTS(SELECT * FROM expected_migration_prefix EXCEPT SELECT * FROM actual_migration_prefix)
  AND NOT EXISTS(SELECT * FROM actual_migration_prefix EXCEPT SELECT * FROM expected_migration_prefix)
  AND NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_review_retention_binding_v1)
  AND NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_binding_v1)
  AND NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_retention_binding_v1)
  AND NOT EXISTS(SELECT 1 FROM review_recipe q WHERE r.bindings#>>ARRAY['routines',q.name,'sha'] IS DISTINCT FROM q.sha)
  AND NOT EXISTS(SELECT 1 FROM retention_recipe q WHERE t.bindings#>>ARRAY['routines',q.name,'sha'] IS DISTINCT FROM q.sha)
  AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys((r.bindings->'triggers')-'FileObject_contract_direct_archive_retention_v1') q(key))
      =(SELECT array_agg(key ORDER BY key) FROM unnest(ARRAY['ContractEconomicReview_direct_source_guard_v1','ContractEconomicReview_direct_source_files_v1','ContractEconomicReviewFileReference_guard_v1','ContractEconomicReview_direct_source_complete_v1','ContractEconomicReviewFileReference_complete_v1','FileObject_contract_direct_review_retention_v1','ContractEconomicReview_immutable','PaymentExecutionPayerAttestation_evidence_immutable','VerifiedBankTransactionObservation_evidence_immutable','jg_direct_pending_file_retained','jg_efb_file_replacement']::text[]) q(key))
  AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(t.bindings->'triggers') q(key))
      =(SELECT array_agg(key ORDER BY key) FROM unnest(ARRAY['jg_direct_archive_retention_binding_immutable','jg_direct_archive_retention_binding_no_truncate','FileObject_contract_direct_archive_retention_v1','FileObject_contract_direct_review_retention_v1','ContractArchiveFile_direct_complete_v1','ContractArchiveEvidenceFile_direct_complete_v1','ContractArchiveFile_v2_complete','ContractArchiveEvidenceFile_v2_complete']::text[]) q(key))
  AND r.bindings#>'{triggers,FileObject_contract_direct_archive_retention_v1}'
      =t.bindings#>'{triggers,FileObject_contract_direct_archive_retention_v1}';

  FOR caller IN SELECT DISTINCT r FROM unnest(snapshot.file_caller_oids||ARRAY[snapshot.application_oid]::oid[]) f(r) LOOP
    IF NOT has_schema_privilege(caller,snapshot.namespace_oid,'USAGE')
      OR EXISTS(SELECT 1 FROM (VALUES
        ('public."ContractArchiveFile"'::regclass,ARRAY['id','contractVersionId','archiveProtocolVersion','archiveSource']),
        ('public."ContractArchiveEvidenceFile"'::regclass,ARRAY['archiveFileId','contractVersionId','fileId']),
        ('public."FileObject"'::regclass,ARRAY['id','objectKey']),
        (reference_table,ARRAY['fileId','objectKey'])
      ) checks(rel,cols) CROSS JOIN LATERAL unnest(checks.cols) col(name)
        WHERE NOT has_column_privilege(caller,checks.rel,col.name,'SELECT'))
      OR NOT has_function_privilege(caller,'public.jg_protect_contract_direct_review_file_v1()'::regprocedure,'EXECUTE')
      OR NOT has_function_privilege(caller,'public.jg_protect_contract_direct_archive_file_v1()'::regprocedure,'EXECUTE') THEN
      RAISE EXCEPTION 'POST213_FILE_READ_SCOPE_REJECTED' USING ERRCODE='JGD13';
    END IF;
  END LOOP;

  IF EXISTS(SELECT 1 FROM unnest(ARRAY[
      'public.jg_require_contract_direct_archive_complete_v1()'::regprocedure,
      'public.jg_contract_direct_archive_proof_v1(text)'::regprocedure,
      'public.jg_contract_direct_archive_request_sha_v1(text,text,text,text,integer,text,text[])'::regprocedure
    ]) f(oid) WHERE NOT has_function_privilege(snapshot.application_oid,f.oid,'EXECUTE'))
    OR EXISTS(SELECT 1 FROM (VALUES
      ('public."ContractArchiveFile"'::regclass,ARRAY['confirmedAt','authoritySnapshot']),
      ('public."ContractVersion"'::regclass,ARRAY['id','contractId','affiliateAssignmentId','affiliateBusinessPartyVersionId']),
      ('public."Contract"'::regclass,ARRAY['id','projectId']),
      ('public."Project"'::regclass,ARRAY['id','isActive','operatingLedgerEffectiveDate']),
      ('public."ProjectAffiliateAssignment"'::regclass,ARRAY['id','projectId','effectiveFrom','endedAt','businessPartyVersionId','businessPartyId']),
      ('public."OperatingFact"'::regclass,ARRAY['sourceType','sourceBusinessId']),
      ('public."OperatingImpactEntry"'::regclass,ARRAY['sourceType','sourceBusinessId'])
    ) checks(rel,cols) CROSS JOIN LATERAL unnest(checks.cols) col(name)
      WHERE NOT has_column_privilege(snapshot.application_oid,checks.rel,col.name,'SELECT')) THEN
    RAISE EXCEPTION 'POST213_APPLICATION_ARCHIVE_READ_REJECTED' USING ERRCODE='JGD14';
  END IF;

  INSERT INTO public.jg_contract_direct_review_retention_binding_v1
    ("protocolVersion","applicationRoleOid","databaseOid","anchorOwnerOid","bindings")
    VALUES(1,snapshot.application_oid,snapshot.database_oid,snapshot.owner_oid,snapshot.review_bindings);
  SELECT r.tableoid AS relation_oid,encode(public.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex') AS sha
    INTO STRICT review_row FROM public.jg_contract_direct_review_retention_binding_v1 r WHERE r."protocolVersion"=1;

  INSERT INTO public.jg_contract_direct_archive_binding_v1
    ("protocolVersion","recipeVersion","applicationRoleOid","fileCallerOids","databaseOid","anchorNamespaceOid","anchorOwnerOid",
      "pendingRelationOid","reviewRelationOid","pendingSha256","reviewSha256")
    VALUES(1,'contract-direct-archive-preparation-v1/1',snapshot.application_oid,
      ARRAY(SELECT f.oid FROM unnest(snapshot.file_caller_oids) f(oid) ORDER BY f.oid),
      snapshot.database_oid,snapshot.namespace_oid,snapshot.owner_oid,snapshot.pending_relation_oid,review_row.relation_oid,
      snapshot.pending_sha,review_row.sha);
  SELECT p.tableoid AS relation_oid,encode(public.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') AS sha
    INTO STRICT prepare_row FROM public.jg_contract_direct_archive_binding_v1 p WHERE p."protocolVersion"=1;

  INSERT INTO public.jg_contract_direct_archive_retention_binding_v1
    ("protocolVersion","recipeVersion","applicationRoleOid","databaseOid","anchorOwnerOid","preparationRelationOid",
      "preparationSha256","bindings")
    VALUES(1,'contract-direct-archive-retention-v1/1',snapshot.application_oid,snapshot.database_oid,snapshot.owner_oid,
      prepare_row.relation_oid,prepare_row.sha,snapshot.retention_bindings);
  SELECT r.tableoid AS relation_oid,encode(public.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex') AS sha
    INTO STRICT retained_row FROM public.jg_contract_direct_archive_retention_binding_v1 r WHERE r."protocolVersion"=1;

  RAISE NOTICE 'POST213_WITNESSES_STAGED %', jsonb_build_object(
    'scope','LOCAL_TECHNICAL_FIXTURE_NOT_BUSINESS_ADMISSION','migrationCount',213,
    'reviewSha256',review_row.sha,'preparationSha256',prepare_row.sha,'retentionSha256',retained_row.sha,
    'databaseOid',snapshot.database_oid::text,'ownerOid',snapshot.owner_oid::text,'backendPid',pg_backend_pid());
END;
$supply$;
