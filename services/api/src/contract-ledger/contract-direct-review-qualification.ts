import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { directArchiveRetentionFileTrigger } from "../contract/contract-direct-archive-retention-qualification";
import { assertDirectPendingSourceQualification } from "../contract/contract-direct-pending-source";

const bindingRelation = "jg_contract_direct_review_retention_binding_v1";
const referenceRelation = "ContractEconomicReviewFileReference";
const referenceColumns = [
  "reviewId", "sourceRef", "displayOrder", "sourceContractVersionId", "directInputProtocolVersion",
  "sourceRevision", "inputSha256", "fileId", "mimeType", "sizeBytes", "contentSha256", "bucket", "objectKey"
];
const bindingColumns = ["protocolVersion", "applicationRoleOid", "databaseOid", "anchorOwnerOid", "bindings"];
const bindingTypes = ["23", "26", "26", "26", "3802"];
const referenceTypes = ["25", "25", "23", "25", "23", "23", "25", "25", "25", "23", "25", "25", "25"];
const routineBodies: Record<string, string> = {
  // Exact prosrc bytes in append-only 206. Update only from the independently reviewed source.
  jg_guard_contract_direct_review_v1: "20b307255fb78bd08df03d01708bbb2bf6a8e9660305b15cb24f6acc29a9999c",
  jg_materialize_contract_direct_review_files_v1: "a8b0f5183bbd92fa7362cf5fea5f7b0aff48ad1e366fd1fdc8ca04e7903ce132",
  jg_guard_contract_direct_review_file_reference_v1: "0a637030b274eca9cb609a92549c700946b177befb48e40edac4057b0923e8fd",
  jg_assert_contract_direct_review_files_complete_v1: "dc962c2e969636957e011f11b669e84b7b08096900e0cb03f41cb215eb958b63",
  jg_protect_contract_direct_review_file_v1: "6721a2e5a938aa46cba7a56d2f811eed6d09ce2db2765af44d83fcc1905dfa20"
};
const priorRoutineBodies: Record<string, string> = {
  protectContractEconomicReview: "e31b5ffda24ec9aea17ea49716b517355f87b5f9b6c70d31fcb61b383b3b91b1",
  guard_payment_execution_payer_evidence_immutable: "cf2f8fd6a49b3cac5fef5e397ebe3f6745455cdd898bdea56b9d7879bbad0f20",
  guard_verified_bank_transaction_observation_evidence_immutable: "1d99af05f59b13e9b0d5e2fddf8ff2d79b201352b2175f5e4f58920bfdd031f1",
  jg_contract_direct_pending_file_guard_v1: "106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1",
  jg_enforce_file_replacement_exclusive_binding: "4c91d71432a110f0b491bb04da4c1f0a0e5d53d7116f5ef1e4f3e2ca7f839bda"
};
const requiredTriggers = [
  ["ContractEconomicReview", "ContractEconomicReview_direct_source_guard_v1", "jg_guard_contract_direct_review_v1", 23, false],
  ["ContractEconomicReview", "ContractEconomicReview_direct_source_files_v1", "jg_materialize_contract_direct_review_files_v1", 17, false],
  ["ContractEconomicReviewFileReference", "ContractEconomicReviewFileReference_guard_v1", "jg_guard_contract_direct_review_file_reference_v1", 31, false],
  ["ContractEconomicReview", "ContractEconomicReview_direct_source_complete_v1", "jg_assert_contract_direct_review_files_complete_v1", 17, true],
  ["ContractEconomicReviewFileReference", "ContractEconomicReviewFileReference_complete_v1", "jg_assert_contract_direct_review_files_complete_v1", 5, true],
  ["FileObject", "FileObject_contract_direct_review_retention_v1", "jg_protect_contract_direct_review_file_v1", 31, false]
] as const;
const guardedFileColumns = ["contentSha256", "storageStatus", "uploadedByUserId", "supersedesFileObjectId"];
const priorTriggers = [
  ["ContractEconomicReview", "ContractEconomicReview_immutable", "protectContractEconomicReview", 27, [], ""],
  ["FileObject", "PaymentExecutionPayerAttestation_evidence_immutable", "guard_payment_execution_payer_evidence_immutable", 27, guardedFileColumns, ""],
  ["FileObject", "VerifiedBankTransactionObservation_evidence_immutable", "guard_verified_bank_transaction_observation_evidence_immutable", 27, guardedFileColumns, ""],
  ["FileObject", "jg_direct_pending_file_retained", "jg_contract_direct_pending_file_guard_v1", 27, [], ""],
  ["FileObject", "jg_efb_file_replacement", "jg_enforce_file_replacement_exclusive_binding", 23, ["supersedesFileObjectId"], ""]
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function unavailable(): never {
  throw new ServiceUnavailableException("直签复核和原件留存资格尚未完整核对，请保留资料稍后办理");
}

interface DirectReviewQualification {
  pending: Awaited<ReturnType<typeof assertDirectPendingSourceQualification>>;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
}
export async function assertDirectReviewQualification(tx: Prisma.TransactionClient, purpose: "read" | "write" = "write"): Promise<DirectReviewQualification> {
  try {
    const pending = await assertDirectPendingSourceQualification(tx);
    // These are two independent sources: a trusted expected binding, and the
    // current session's exact objects/rights. No app-side binding provisioner.
    const expectedRows = await tx.$queryRaw<unknown[]>(Prisma.sql`
      SELECT "applicationRoleOid"::text AS "applicationRoleOid", "databaseOid"::text AS "databaseOid",
        "anchorOwnerOid"::text AS "anchorOwnerOid", "bindings"
      FROM public.jg_contract_direct_review_retention_binding_v1 WHERE "protocolVersion"=1
    `);
    const expected = expectedRows.length === 1 ? record(expectedRows[0]) : null;
    if (!expected || expected.applicationRoleOid !== pending.expected.applicationRoleOid ||
      expected.databaseOid !== pending.expected.databaseOid || expected.anchorOwnerOid !== pending.expected.anchorOwnerOid) unavailable();
    const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
      /* contract_direct_review_retention_catalog_v1 */
      WITH requested_routines AS (SELECT unnest(${Object.keys({...routineBodies,...priorRoutineBodies})}::text[]) AS name),
      requested_relations AS (SELECT unnest(${[bindingRelation, referenceRelation, "ContractEconomicReview", "FileObject", "ContractVersion", "Contract", "Project"]}::text[]) AS name),
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
            t.tgfoid IN (SELECT oid FROM routines WHERE name=ANY(${Object.keys(routineBodies)}::text[]))
            OR t.tgrelid IN ('public."ContractEconomicReview"'::regclass,'public."ContractEconomicReviewFileReference"'::regclass,'public."FileObject"'::regclass))),
        'triggerCount', (SELECT count(*)::integer FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND (
          t.tgfoid IN (SELECT oid FROM routines WHERE name=ANY(${Object.keys(routineBodies)}::text[]))
          OR t.tgrelid IN ('public."ContractEconomicReview"'::regclass,'public."ContractEconomicReviewFileReference"'::regclass,'public."FileObject"'::regclass))),
        'foreignKeys', (SELECT count(*)::integer FROM pg_catalog.pg_constraint c
          WHERE c.conrelid='public."ContractEconomicReviewFileReference"'::regclass AND c.contype='f' AND c.convalidated
            AND c.confupdtype='r' AND c.confdeltype='r' AND NOT c.condeferrable
            AND ((c.confrelid='public."ContractEconomicReview"'::regclass AND c.conkey=ARRAY[1]::smallint[])
              OR (c.confrelid='public."FileObject"'::regclass AND c.conkey=ARRAY[8]::smallint[]))
            AND c.confkey=ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.confrelid AND a.attname='id')]::smallint[]
            AND 4=(SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgconstraint=c.oid AND t.tgisinternal AND t.tgenabled='O')),
        'identityKeys', (SELECT count(*)::integer FROM pg_catalog.pg_constraint c
          WHERE c.conrelid='public."ContractEconomicReviewFileReference"'::regclass AND c.convalidated AND NOT c.condeferrable
            AND ((c.contype='p' AND c.conkey=ARRAY[1,2,3]::smallint[])
              OR (c.contype='u' AND c.conkey=ARRAY[1,2,8]::smallint[]))),
        'noPublicRoutineExecute', NOT EXISTS (SELECT 1 FROM routines r
          CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(r.proacl,pg_catalog.acldefault('f',r.proowner))) acl
          WHERE r.name=ANY(${Object.keys(routineBodies)}::text[]) AND acl.grantee=0 AND acl.privilege_type='EXECUTE'),
        'replicationOrigin', pg_catalog.current_setting('session_replication_role')='origin',
        'reads', pg_catalog.has_schema_privilege(current_user,'public','USAGE')
          AND pg_catalog.has_table_privilege(current_user,'public.jg_contract_direct_review_retention_binding_v1','SELECT')
          AND pg_catalog.has_table_privilege(current_user,'public."ContractEconomicReviewFileReference"','SELECT')
          AND pg_catalog.has_column_privilege(current_user,'public."ContractEconomicReview"','directSourcePins','SELECT')
          AND NOT EXISTS(SELECT 1 FROM (VALUES
            ('ContractEconomicReview',ARRAY['id','status','directSourcePins','frozenSources','confirmedAt']),
            ('ContractVersion',ARRAY['id','contractId','versionNo','changeType','numericProtocolVersion','status','effectiveAt','firstSubmittedAt','draftData','draftRevision']),
            ('Contract',ARRAY['id','projectId','voidedAt']), ('Project',ARRAY['id','isActive']),
            ('FileObject',ARRAY['id','bucket','objectKey','mimeType','sizeBytes','contentSha256','storageStatus','purgeReceiptId','supersedesFileObjectId'])
          ) AS required(table_name,columns) CROSS JOIN LATERAL unnest(required.columns) AS c(name)
            WHERE pg_catalog.has_column_privilege(current_user,pg_catalog.format('public.%I',required.table_name),c.name,'SELECT') IS DISTINCT FROM TRUE)
          AND NOT EXISTS(SELECT 1 FROM relations WHERE oid IS NULL OR relkind<>'r' OR relrowsecurity OR relforcerowsecurity),
        'writes', pg_catalog.has_table_privilege(current_user,'public."ContractEconomicReviewFileReference"','INSERT')
          AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['id','projectId','leftSourceRef','rightSourceRef','leftFingerprint','rightFingerprint',
            'relation','coverage','reason','preparedByUserId','idempotencyKey','requestFingerprint','targetSourceRef','targetVersionId','supersedesReviewId',
            'financeRequired','directSourcePins']) AS c(name)
            WHERE pg_catalog.has_column_privilege(current_user,'public."ContractEconomicReview"',c.name,'INSERT') IS DISTINCT FROM TRUE)
          AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['financeRequired','revision','status','contractReviewedById','financeReviewedById','confirmedAt','frozenSources',
            'returnedAt','returnReason']) AS c(name)
            WHERE pg_catalog.has_column_privilege(current_user,'public."ContractEconomicReview"',c.name,'UPDATE') IS DISTINCT FROM TRUE)
          AND pg_catalog.has_function_privilege(current_user,'pg_catalog.pg_try_advisory_xact_lock(bigint)','EXECUTE')
          AND pg_catalog.has_function_privilege(current_user,'pg_catalog.hashtextextended(text,bigint)','EXECUTE')
          AND EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='public."FileObject"'::regclass
              AND a.attnum>0 AND NOT a.attisdropped AND pg_catalog.has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE')),
        'noElevatedRights', NOT EXISTS(SELECT 1 FROM reachable member
          WHERE pg_catalog.has_parameter_privilege(member.oid,'session_replication_role','SET'))
          AND NOT EXISTS(SELECT 1 FROM reachable member CROSS JOIN relations r
          WHERE pg_catalog.pg_has_role(member.oid,r.relowner,'MEMBER')
            OR pg_catalog.has_table_privilege(member.oid,r.oid,'TRUNCATE,TRIGGER')
            OR (r.name IN ('jg_contract_direct_review_retention_binding_v1','ContractEconomicReviewFileReference') AND
              (pg_catalog.has_table_privilege(member.oid,r.oid,'UPDATE,DELETE')
               OR (r.name='jg_contract_direct_review_retention_binding_v1' AND pg_catalog.has_table_privilege(member.oid,r.oid,'INSERT'))
               OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped
                 AND (pg_catalog.has_column_privilege(member.oid,r.oid,a.attnum,'UPDATE') OR
                   (r.name='jg_contract_direct_review_retention_binding_v1' AND pg_catalog.has_column_privilege(member.oid,r.oid,a.attnum,'INSERT'))))))),
        'sessionRoleOid', (session_user::regrole::oid)::text, 'currentRoleOid', (current_user::regrole::oid)::text,
        'backendPid',pg_catalog.pg_backend_pid(),'transactionId',pg_catalog.txid_current()::text
      ) AS actual
    `);
    const actual = rows.length === 1 ? record(record(rows[0])?.actual) : null;
    const relations = record(actual?.relations), routines = record(actual?.routines), triggers = record(actual?.triggers);
    const legacyTriggers = triggers ? { ...triggers } : null;
    if (pending.retention) {
      if (!legacyTriggers || !isDeepStrictEqual(legacyTriggers[directArchiveRetentionFileTrigger], pending.retention.fileTrigger)) unavailable();
      delete legacyTriggers[directArchiveRetentionFileTrigger];
    }
    if (!actual || !relations || !routines || !triggers || actual.reads !== true || (purpose === "write" && actual.writes !== true) || actual.noElevatedRights !== true ||
      actual.currentRoleOid !== expected.applicationRoleOid || actual.sessionRoleOid !== expected.applicationRoleOid ||
      actual.backendPid !== pending.bootstrap.backendPid || actual.transactionId !== pending.bootstrap.transactionId ||
      actual.replicationOrigin !== true || actual.foreignKeys !== 2 || actual.identityKeys !== 2 || actual.noPublicRoutineExecute !== true ||
      (pending.transition !== null && pending.transition.binding.reviewRelationOid !== record(relations[bindingRelation])?.oid) ||
      !isDeepStrictEqual(expected.bindings, { relations, routines, triggers: legacyTriggers })) unavailable();
    for (const [name, columns, types] of [[bindingRelation, bindingColumns, bindingTypes], [referenceRelation, referenceColumns, referenceTypes]] as const) {
      const relation = record(relations[name]);
      if (!relation || relation.owner !== expected.anchorOwnerOid || relation.kind !== "r" || relation.rls !== false || relation.forceRls !== false ||
        !Array.isArray(relation.columns) || !isDeepStrictEqual(relation.columns.map(column => record(column)?.name), columns) ||
        relation.columns.some((column, index) => record(column)?.notNull !== true || record(column)?.type !== types[index])) unavailable();
    }
    const review = record(relations.ContractEconomicReview);
    if (!Array.isArray(review?.columns) || !review.columns.some(column => {
      const value = record(column);
      return value?.name === "directSourcePins" && value.type === "3802" && value.notNull === false;
    })) unavailable();
    for (const [name, sha] of Object.entries(routineBodies)) {
      const routine = record(routines[name]);
      if (!routine || typeof routine.oid !== "string" || routine.owner !== expected.anchorOwnerOid || routine.definer !== false ||
        routine.language !== "plpgsql" || routine.returnType !== "2279" || routine.volatility !== "v" ||
        !isDeepStrictEqual(routine.configuration, ["search_path=pg_catalog, pg_temp"]) || routine.sha !== sha) unavailable();
    }
    for (const [name, sha] of Object.entries(priorRoutineBodies)) {
      const routine = record(routines[name]);
      if (!routine || typeof routine.oid !== "string" || routine.sha !== sha || routine.definer !== false ||
        routine.language !== "plpgsql" || routine.returnType !== "2279" || routine.volatility !== "v") unavailable();
    }
    const triggerChecks = [
      ...requiredTriggers.map(([table, name, routine, type, deferred]) => ({ table, name, routine, type, deferred, columns: [], args: "" })),
      ...priorTriggers.map(([table, name, routine, type, columns, args]) => ({ table, name, routine, type, deferred: false, columns, args }))
    ];
    const observedCount = triggerChecks.length + (pending.retention ? 1 : 0);
    if (actual.triggerCount !== observedCount || Object.keys(triggers).length !== observedCount) unavailable();
    for (const {table, name, routine, type, deferred, columns, args} of triggerChecks) {
      const trigger = record(triggers[name]);
      if (!trigger || typeof trigger.oid !== "string" || trigger.relation !== record(relations[table])?.oid ||
        trigger.routine !== record(routines[routine])?.oid || trigger.enabled !== "O" || trigger.type !== type ||
        trigger.deferred !== deferred || trigger.initiallyDeferred !== deferred || trigger.args !== args ||
        !isDeepStrictEqual(trigger.columns, columns) || trigger.condition !== false || trigger.internal !== false) unavailable();
    }
    return { pending, expected, actual };
  } catch (error) {
    if (error instanceof ServiceUnavailableException) throw error;
    unavailable();
  }
}

export async function assertDirectReviewContinuity(tx: Prisma.TransactionClient, before: DirectReviewQualification) {
  if (!isDeepStrictEqual(await assertDirectReviewQualification(tx), before)) unavailable();
}
