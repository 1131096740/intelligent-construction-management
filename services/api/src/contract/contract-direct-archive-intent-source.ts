import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/** Catalog diagnosis only. This does not read, issue or consume a private intent. */
export async function assertDirectArchiveIntentSourceClosed(tx: Prisma.TransactionClient, anchor: Record<string, unknown>) {
  function unavailable(): never {
    throw new ServiceUnavailableException("直签登记执行隔离尚未完整核对，请保留原件和本次标识");
  }
  const ownerOid = anchor.anchorOwnerOid;
  if (typeof ownerOid !== "string" || !/^[1-9][0-9]{0,9}$/u.test(ownerOid)) unavailable();
  try {
    const rows = await tx.$queryRaw<Array<{
      relationCount: number; routineCount: number; triggerCount: number; privateSource: boolean;
      databaseOid: string; sessionRoleOid: string; currentRoleOid: string; backendPid: number; transactionId: string;
    }>>(Prisma.sql`
      /* contract_direct_archive_intent_source_v1 */
      WITH relation_specs(name,column_count) AS (VALUES
        ('jg_contract_direct_archive_intent_binding_v1',11),
        ('jg_contract_direct_archive_intent_v1',5),
        ('jg_contract_direct_archive_intent_use_v1',7)
      ), routine_specs(name,signature,body_sha,result,volatility,strict,definer) AS (VALUES
        ('jg_guard_contract_direct_archive_intent_append_v1','public.jg_guard_contract_direct_archive_intent_append_v1()',
          '4aa93183b5962e747ebe7f282bbe4fcedf5b1207ad31582033ff1d9e7a79424e','pg_catalog.trigger','v',false,false),
        ('jg_check_contract_direct_archive_intent_roles_v1','public.jg_check_contract_direct_archive_intent_roles_v1(boolean)',
          'b55d8f0b06662ff593514357e29d9503576c14de8c5ab98a51f8ef825b5be9c2','pg_catalog.text','v',true,false),
        ('jg_contract_direct_archive_intent_payload_v1','public.jg_contract_direct_archive_intent_payload_v1(text,text,text,text,integer,text,text,jsonb)',
          '0ae73d99bde8ae0dc87295d5a296844e8c10fb1a70c8b8f96e1a5aa210db8ddc','pg_catalog.jsonb','s',true,false),
        ('jg_issue_contract_direct_archive_intent_v1','public.jg_issue_contract_direct_archive_intent_v1(text,text,text,text,integer,text,text,jsonb)',
          '0a23f773a3a7d26ef01402a8b63de715bc4fed1fb829ba7425d618b9c1fab843','pg_catalog.uuid','v',true,true),
        ('jg_consume_contract_direct_archive_intent_v1','public.jg_consume_contract_direct_archive_intent_v1(uuid,text,text,text,text,integer,text,text,jsonb)',
          'fd818746c316d13ee04dc139e251c992787a9b212b7bd61854f8ceabcc9eb0f0','pg_catalog.jsonb','v',true,false)
      ), trigger_specs(table_name,name,type) AS (VALUES
        ('jg_contract_direct_archive_intent_binding_v1','jg_direct_archive_intent_binding_append',31),
        ('jg_contract_direct_archive_intent_binding_v1','jg_direct_archive_intent_binding_no_truncate',34),
        ('jg_contract_direct_archive_intent_v1','jg_direct_archive_intent_append',31),
        ('jg_contract_direct_archive_intent_v1','jg_direct_archive_intent_no_truncate',34),
        ('jg_contract_direct_archive_intent_use_v1','jg_direct_archive_intent_use_append',31),
        ('jg_contract_direct_archive_intent_use_v1','jg_direct_archive_intent_use_no_truncate',34)
      ), relations AS (
        SELECT c.*,s.column_count FROM pg_catalog.pg_class c JOIN relation_specs s ON s.name=c.relname
        WHERE c.relnamespace='public'::regnamespace
      ), routines AS (
        SELECT p.*,l.lanname,s.signature,s.body_sha,s.result,s.volatility,s.strict,s.definer
        FROM pg_catalog.pg_proc p JOIN routine_specs s ON s.name=p.proname
        JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.pronamespace='public'::regnamespace
      ), triggers AS (
        SELECT t.* FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
        WHERE t.tgfoid IN (SELECT p.oid FROM routines p)
          OR (c.relnamespace='public'::regnamespace AND t.tgname IN (SELECT name FROM trigger_specs))
      ), trusted AS (SELECT ${ownerOid}::pg_catalog.oid AS owner)
      SELECT (SELECT count(*)::integer FROM relations) AS "relationCount",
        (SELECT count(*)::integer FROM routines) AS "routineCount",
        (SELECT count(*)::integer FROM triggers) AS "triggerCount",
        NOT pg_catalog.pg_has_role(current_user::regrole::oid, trusted.owner,'MEMBER')
        AND NOT EXISTS (SELECT 1 FROM relations c
          WHERE c.relowner<>trusted.owner OR c.relkind<>'r' OR c.relpersistence<>'p' OR c.relispartition
            OR c.relrowsecurity OR c.relforcerowsecurity
            OR c.column_count<>(SELECT count(*) FROM pg_catalog.pg_attribute a
              WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
            OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
            OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
              WHERE acl.grantee<>c.relowner OR acl.grantor<>c.relowner))
        AND NOT EXISTS (SELECT 1 FROM routines p
          WHERE p.oid IS DISTINCT FROM pg_catalog.to_regprocedure(p.signature)::oid OR p.proowner<>trusted.owner
            OR p.prokind<>'f' OR p.proretset OR p.proparallel<>'u' OR p.lanname<>'plpgsql'
            OR p.prorettype IS DISTINCT FROM pg_catalog.to_regtype(p.result)::oid OR p.provolatile::text<>p.volatility
            OR p.proisstrict IS DISTINCT FROM p.strict OR p.prosecdef IS DISTINCT FROM p.definer
            OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
            OR encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p.body_sha
            OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
              WHERE acl.grantee<>p.proowner OR acl.grantor<>p.proowner))
        AND 6=(SELECT count(*) FROM trigger_specs s JOIN relations c ON c.relname=s.table_name
          JOIN triggers t ON t.tgrelid=c.oid AND t.tgname=s.name AND t.tgtype=s.type
          WHERE t.tgfoid=pg_catalog.to_regprocedure('public.jg_guard_contract_direct_archive_intent_append_v1()')::oid
            AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred
            AND t.tgnargs=0 AND t.tgattr::text='' AND encode(t.tgargs,'hex')='' AND t.tgqual IS NULL)
        AS "privateSource",
        db.oid::text AS "databaseOid", session_user::regrole::oid::text AS "sessionRoleOid",
        current_user::regrole::oid::text AS "currentRoleOid", pg_catalog.pg_backend_pid() AS "backendPid",
        pg_catalog.txid_current()::text AS "transactionId"
      FROM trusted JOIN pg_catalog.pg_database db ON db.datname=pg_catalog.current_database()
    `);
    const row = rows.length === 1 ? rows[0] : null;
    if (!row || !(["databaseOid","sessionRoleOid","currentRoleOid","backendPid","transactionId"] as const).every(key => row[key] === anchor[key])) unavailable();
    const absent = row.relationCount === 0 && row.routineCount === 0 && row.triggerCount === 0;
    const detached = row.relationCount === 3 && row.routineCount === 5 && row.triggerCount === 6 && row.privateSource === true;
    if (absent || detached) return;
  } catch {
    // Unknown catalog state cannot authorize private evidence or a write.
  }
  unavailable();
}
