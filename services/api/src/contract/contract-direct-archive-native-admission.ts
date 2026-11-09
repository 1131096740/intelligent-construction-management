import { Prisma } from "@prisma/client";

export const directInputSignature = "public.jg_contract_direct_pending_input_v1(pg_catalog.text)";
export const directWriteProfile = "public.jg_assert_contract_direct_archive_write_profile_v1()";
export const directParentGuard = 'public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")';
export const directTransitionProfile = "public.jg_require_contract_direct_archive_transition_profile_v1()";
export const directVersionTransition = 'public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion")';
export const nativeDirectBodies: Readonly<Record<string, string>> = {
  [directWriteProfile]: "b418f8e2de1ae5b4607a898d8de4ca96c1e3b987c2ffbd8a8701018e76c56349",
  [directParentGuard]: "1e9d6404ecd618617aa74dc85fc656be334f1b0d8219d7e814361866f6e4b903",
  [directTransitionProfile]: "c34dead07d5837558a41e68350b21b8b2d5818f60e21eef23c43c59f68bbb23a",
  [directVersionTransition]: "c376d219b8d97e2d8e895f39fcf6af1b768fef8ae2dff9c37d356d8374086157"
};

type NativeDirectAdmission = {
  completionOid: string; executorOwnerOid: string; intentBindingSha256: string; nonce: string; ownerOid: string; namespaceOid: string;
  databaseOid: string; currentRoleOid: string; sessionRoleOid: string; backendPid: number; transactionId: string;
};

const recipe = Prisma.join([
  ...Object.entries(nativeDirectBodies).map(([signature, sha]) => Prisma.sql`(${signature}::text,${sha}::text,'anchor','executor',FALSE,FALSE)`),
  Prisma.sql`(${directInputSignature},'24e586804f996807e6c0d28bc5e1401551fc1c73e92eca93cec4a06c50b1f6e9',
    'anchor','oldInput',FALSE,FALSE)`,
  Prisma.sql`('public.jg_contract_direct_archive_proof_v1(text)','4c24e5aa811a8b9c98897377987dd59e4baf3d4d6cf323f049eac77c68a8b00f',
    'anchor','oldProof',FALSE,FALSE)`,
  Prisma.sql`('public.jg_contract_direct_archive_request_sha_v1(text,text,text,text,integer,text,text[])',
    'f3e329de50e81169c974f55e6c0a965237372f47c2af950c12c8e1d406294cbf','anchor','oldHash',FALSE,FALSE)`,
  Prisma.sql`('public.jg_write_contract_direct_archive_v1(text,text,text,integer,text,text[],jsonb)',
    'df0c7cdab49101a1b09a4b06177918debeeb284635afd9d6e21af931274074c0','anchor','executor',FALSE,TRUE)`,
  Prisma.sql`('public.jg_contract_direct_archive_outside_profile_v1()',
    'c0101a8c6d2283f6d58d2ef65a77b49ce7a00686559f45efad1e407ed96ce842','anchor','executor',FALSE,FALSE)`,
  Prisma.sql`('public.jg_check_contract_direct_archive_intent_roles_v1(boolean)',
    '19afa3783a3a18126af58e7e61633367ec6d745eb602e88cbe36d7c7a790cde9','anchor','owners',FALSE,FALSE)`,
  Prisma.sql`('public.jg_issue_contract_direct_archive_intent_v1(text,text,text,text,integer,text,text,jsonb)',
    '0a23f773a3a7d26ef01402a8b63de715bc4fed1fb829ba7425d618b9c1fab843','issuer','issuerLogin',TRUE,FALSE)`,
  Prisma.sql`('public.jg_consume_contract_direct_archive_intent_v1(uuid,text,text,text,text,integer,text,text,jsonb)',
    'fd818746c316d13ee04dc139e251c992787a9b212b7bd61854f8ceabcc9eb0f0','executor','private',FALSE,FALSE)`,
  Prisma.sql`('public.jg_execute_contract_direct_archive_outside_v1(uuid,text,text,text,text,integer,text,text,jsonb)',
    '6cb7d9c5be655cd9c69a22027be5964e84d9b2daa1f9e58942f9449509f0ce72','executor','executorLogin',TRUE,FALSE)`,
  Prisma.sql`('public.jg_guard_contract_direct_archive_native_nonce_v1()',
    '0c8b12eecce8c9fa02ed8f804084764999ec01b17b670e0e255f013211d6bc8b','anchor','private',FALSE,FALSE)`,
  Prisma.sql`('public.jg_contract_direct_archive_native_channel_v1()',
    'ee18e2291342b5bed5f9b583c0d78535ab137876b1ed1ef5e90c180851326c17','anchor','logins',TRUE,FALSE)`,
  Prisma.sql`('public.jg_record_contract_direct_archive_generations_v1(text,uuid,text,text,text,text,integer,text,text,jsonb)',
    '7f383484f39d3e5b5be0cdb955a8a8910cc95dca5ee5d6d09242ce9ba94d08ed','anchor','executor',FALSE,FALSE)`
]);

/** Read-only admission from the same ordinary application transaction as the request source. */
export async function readDirectArchiveNativeAdmission(tx: Prisma.TransactionClient, identity: Record<string, unknown>) {
  const [probe] = await tx.$queryRaw<Array<{ readable: boolean }>>(Prisma.sql`
    /* contract_direct_native_probe_v1 */
    SELECT COALESCE(pg_catalog.has_table_privilege(current_user::regrole::oid,
      pg_catalog.to_regclass('public.jg_contract_direct_archive_native_binding_v1'),'SELECT'),FALSE) AS readable
  `);
  if (probe?.readable !== true) return null;

  const rows = await tx.$queryRaw<NativeDirectAdmission[]>(Prisma.sql`
    /* contract_direct_native_admission_v1 */
    WITH recipe(signature,body,owner_role,caller,definer,writer_path) AS (VALUES ${recipe})
    SELECT c.tableoid::text AS "completionOid",b."executorOwnerOid"::text AS "executorOwnerOid",b."intentBindingSha256",b."nonce"::text AS nonce,
      v.relowner::text AS "ownerOid",v.relnamespace::text AS "namespaceOid",b."databaseOid"::text AS "databaseOid",
      current_user::regrole::oid::text AS "currentRoleOid",session_user::regrole::oid::text AS "sessionRoleOid",
      pg_catalog.pg_backend_pid() AS "backendPid",pg_catalog.txid_current()::text AS "transactionId"
    FROM public.jg_contract_direct_archive_native_binding_v1 b
    JOIN public.jg_contract_direct_archive_completion_binding_v1 c ON c.tableoid=b."completionRelationOid"
      AND c."protocolVersion"=1 AND c."recipeVersion"='contract-direct-archive-completion-dispatch-v1/1'
      AND c."databaseOid"=b."databaseOid" AND c."namespaceOid"=b."namespaceOid"
      AND c."anchorOwnerOid"=b."anchorOwnerOid" AND c."applicationRoleOid"=b."ordinaryApplicationRoleOid"
    JOIN pg_catalog.pg_class cc ON cc.oid=c.tableoid AND cc.relowner=b."anchorOwnerOid" AND cc.relnamespace=b."namespaceOid"
      AND cc.relkind='r' AND cc.relpersistence='p' AND NOT cc.relispartition AND NOT cc.relrowsecurity AND NOT cc.relforcerowsecurity
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    JOIN pg_catalog.pg_class v ON v.oid=pg_catalog.to_regclass('public.jg_contract_direct_archive_native_binding_v1')
      AND v.relowner=b."anchorOwnerOid" AND v.relnamespace=b."namespaceOid" AND v.relkind='v'
      AND v.reloptions=ARRAY['security_barrier=true']
    WHERE current_user=session_user AND current_user::regrole::oid=b."ordinaryApplicationRoleOid"
      AND b."namespaceOid"=pg_catalog.to_regnamespace('public')
      AND pg_catalog.current_setting('session_replication_role')='origin'
      AND b."intentBindingSha256"~'^[a-f0-9]{64}$'
      AND 3=(SELECT count(*) FROM pg_catalog.aclexplode(cc.relacl) a WHERE a.grantor=cc.relowner
        AND a.grantee IN (b."ordinaryApplicationRoleOid",b."issuerOwnerOid",b."executorOwnerOid")
        AND a.privilege_type='SELECT' AND NOT a.is_grantable)
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(cc.relacl) a WHERE a.grantor<>cc.relowner OR
        (a.grantee<>cc.relowner AND (a.grantee NOT IN (b."ordinaryApplicationRoleOid",b."issuerOwnerOid",b."executorOwnerOid")
          OR a.privilege_type<>'SELECT' OR a.is_grantable)))
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=cc.oid AND a.attnum>0 AND a.attacl IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(v.relacl) a WHERE a.grantor<>v.relowner
        OR (a.grantee<>v.relowner AND (a.grantee<>b."ordinaryApplicationRoleOid" OR a.privilege_type<>'SELECT' OR a.is_grantable)))
      AND 4=(SELECT count(*) FROM pg_catalog.pg_roles r
        WHERE r.oid IN (b."issuerSessionOid",b."issuerOwnerOid",b."runtimeSessionOid",b."executorOwnerOid")
          AND r.oid NOT IN (b."anchorOwnerOid",b."ordinaryApplicationRoleOid")
          AND r.rolcanlogin=(r.oid IN (b."issuerSessionOid",b."runtimeSessionOid"))
          AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
          AND NOT pg_catalog.has_schema_privilege(r.oid,b."namespaceOid",'CREATE')
          AND NOT pg_catalog.pg_has_role(b."ordinaryApplicationRoleOid",r.oid,'MEMBER')
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles inherited
            WHERE inherited.oid<>r.oid AND pg_catalog.pg_has_role(r.oid,inherited.oid,'MEMBER')))
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class business
        CROSS JOIN (VALUES(b."issuerSessionOid"),(b."runtimeSessionOid")) login(role)
        WHERE business.relnamespace=b."namespaceOid" AND business.relkind IN ('r','v','p','f','m')
          AND (pg_catalog.has_table_privilege(login.role,business.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR pg_catalog.has_any_column_privilege(login.role,business.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
      AND EXISTS(SELECT 1 FROM pg_catalog.pg_class n
        WHERE n.oid=pg_catalog.to_regclass('public.jg_contract_direct_archive_native_nonce_v1')
          AND n.relowner=b."anchorOwnerOid" AND n.relnamespace=b."namespaceOid" AND n.relkind='r'
          AND n.relpersistence='p' AND NOT n.relispartition AND NOT n.relrowsecurity AND NOT n.relforcerowsecurity
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(n.relacl,pg_catalog.acldefault('r',n.relowner))) a
            WHERE a.grantor<>n.relowner OR a.grantee<>n.relowner)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=n.oid AND a.attnum>0 AND a.attacl IS NOT NULL)
          AND 2=(SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=n.oid
            AND t.tgfoid=pg_catalog.to_regprocedure('public.jg_guard_contract_direct_archive_native_nonce_v1()')
            AND ((t.tgname='jg_direct_native_nonce_immutable' AND t.tgtype=31)
              OR (t.tgname='jg_direct_native_nonce_no_truncate' AND t.tgtype=34))
            AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred
            AND t.tgnargs=0 AND t.tgattr::text='' AND t.tgqual IS NULL))
      AND 16=(SELECT count(*) FROM recipe q
        JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(q.signature) AND p.pronamespace=b."namespaceOid"
        JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname=CASE WHEN q.caller='oldHash' THEN 'sql' ELSE 'plpgsql' END
        CROSS JOIN LATERAL (SELECT CASE WHEN q.caller IN ('executor','oldInput','oldProof') THEN ARRAY[b."executorOwnerOid"]
          WHEN q.caller IN ('owners','oldHash') THEN ARRAY[b."executorOwnerOid",b."issuerOwnerOid"]
          WHEN q.caller='issuerLogin' THEN ARRAY[b."issuerSessionOid"]
          WHEN q.caller='executorLogin' THEN ARRAY[b."runtimeSessionOid"]
          WHEN q.caller='logins' THEN ARRAY[b."issuerSessionOid",b."runtimeSessionOid"] ELSE ARRAY[]::oid[] END AS callers) rights
        CROSS JOIN LATERAL (SELECT CASE q.caller WHEN 'oldInput' THEN (
          SELECT pending."bindings"->'routines'->q.signature->'acl' FROM public.jg_contract_direct_pending_binding_v1 pending
          WHERE pending."protocolVersion"=1 AND pending."databaseOid"=b."databaseOid"
            AND pending."anchorOwnerOid"=b."anchorOwnerOid" AND pending."applicationRoleOid"=b."ordinaryApplicationRoleOid")
          WHEN 'oldProof' THEN retention."bindings"#>'{routines,jg_contract_direct_archive_proof_v1,acl}'
          WHEN 'oldHash' THEN retention."bindings"#>'{routines,jg_contract_direct_archive_request_sha_v1,acl}'
          END AS acl
          FROM public.jg_contract_direct_archive_retention_binding_v1 retention
          WHERE retention."protocolVersion"=1 AND retention.tableoid::text=c."links"->>'retentionOid'
            AND encode(public.digest(convert_to(to_jsonb(retention)::text,'UTF8'),'sha256'),'hex')=c."links"->>'retentionSha') old
        CROSS JOIN LATERAL (SELECT CASE WHEN q.caller IN ('oldInput','oldProof','oldHash') THEN
          COALESCE(ARRAY(SELECT value::aclitem FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(old.acl)='array' THEN old.acl ELSE '[]'::jsonb END)),ARRAY[]::aclitem[])
          ELSE ARRAY[]::aclitem[] END AS acl) expected
        WHERE p.proowner=CASE q.owner_role WHEN 'issuer' THEN b."issuerOwnerOid" WHEN 'executor' THEN b."executorOwnerOid"
          ELSE b."anchorOwnerOid" END
          AND p.prokind='f' AND p.provolatile::text=CASE WHEN q.caller IN ('oldInput','oldProof') THEN 's'
            WHEN q.caller='oldHash' THEN 'i' ELSE 'v' END
          AND p.proparallel::text=CASE WHEN q.caller='oldHash' THEN 's' ELSE 'u' END
          AND NOT p.proretset AND p.prosecdef=q.definer
          AND (q.caller NOT IN ('oldInput','oldProof','oldHash') OR jsonb_typeof(old.acl)='array')
          AND p.proconfig=CASE WHEN q.writer_path THEN ARRAY['search_path=pg_catalog, public, pg_temp']
            WHEN q.caller='oldInput' THEN ARRAY['search_path=pg_catalog, public']
            ELSE ARRAY['search_path=pg_catalog, pg_temp'] END
          AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=q.body
          AND NOT EXISTS(SELECT 1 FROM unnest(rights.callers) AS caller(oid)
            WHERE NOT pg_catalog.has_function_privilege(caller.oid,p.oid,'EXECUTE'))
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(expected.acl) prior
            WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) actual_acl
              WHERE actual_acl=prior))
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
            WHERE (a.grantor<>p.proowner OR (a.grantee<>p.proowner
              AND (NOT (a.grantee=ANY(rights.callers)) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)))
              AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(expected.acl) prior WHERE prior=a)))
    LIMIT 2
  `);
  const row = rows.length === 1 ? rows[0] : null;
  if (!row || row.ownerOid !== identity.anchorOwnerOid
    || !/^[1-9][0-9]{0,9}$/u.test(row.executorOwnerOid) || !/^[1-9][0-9]{0,9}$/u.test(row.completionOid)
    || !/^[a-f0-9]{64}$/u.test(row.intentBindingSha256)
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(row.nonce)
    || !["namespaceOid","databaseOid","currentRoleOid","sessionRoleOid","backendPid","transactionId"].every(
      key => row[key as keyof NativeDirectAdmission] === identity[key])) return null;
  return row;
}
