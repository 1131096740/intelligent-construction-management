import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

type ScopeSource = {
  contractId: string;
  versionId: string;
  projectId: string;
  actor: string;
  sourceRevision: number;
  inputSha256: string;
};

type ScopeCatalog = {
  contractId: string;
  versionId: string;
  projectId: string;
  sourceRevision: number;
  inputSha256: string;
  completionOid: string;
  databaseOid: string;
  sessionRoleOid: string;
  currentRoleOid: string;
  backendPid: number;
  transactionId: string;
  completeReads: boolean;
  otherContract: boolean;
  affiliateFact: boolean;
  relatedReview: boolean;
};

function unavailable(): never {
  throw new ServiceUnavailableException("直签登记范围暂无法完整核对，请保留原件和本次标识");
}

/** Read the narrow source domain supported by both the current kernel and its independent parent guard. */
export async function assertDirectArchiveSourceScope(
  tx: Prisma.TransactionClient, source: ScopeSource, completionOid: unknown, anchor: Record<string, unknown>
) {
  if (typeof completionOid !== "string" || !/^[1-9][0-9]{0,9}$/u.test(completionOid)) unavailable();
  let rows: ScopeCatalog[];
  try {
    rows = await tx.$queryRaw<ScopeCatalog[]>(Prisma.sql`
      /* contract_direct_archive_source_scope_v1 */
      WITH required_reads(table_name,column_name) AS (VALUES
        ('Contract','id'),('Contract','ownerUserId'),('Contract','projectId'),('Contract','voidedAt'),
        ('ContractVersion','id'),('ContractVersion','contractId'),('ContractVersion','draftRevision'),('ContractVersion','draftData'),
        ('ContractVersion','versionNo'),('ContractVersion','changeType'),('ContractVersion','numericProtocolVersion'),
        ('ContractVersion','status'),('ContractVersion','firstSubmittedAt'),('ContractVersion','effectiveAt'),('ContractVersion','endedAt'),
        ('Project','id'),('Project','isActive'),('Project','operatingLedgerEffectiveDate'),
        ('ProjectAffiliateContractFact','projectId'),('ContractEconomicReview','projectId'),
        ('ContractEconomicReview','leftSourceRef'),('ContractEconomicReview','rightSourceRef')
      )
      SELECT c."id" AS "contractId", v."id" AS "versionId", p."id" AS "projectId", v."draftRevision" AS "sourceRevision",
        q.input->>'inputSha256' AS "inputSha256", b.tableoid::text AS "completionOid", db.oid::text AS "databaseOid",
        session_user::regrole::oid::text AS "sessionRoleOid", current_user::regrole::oid::text AS "currentRoleOid",
        pg_catalog.pg_backend_pid() AS "backendPid", pg_catalog.txid_current()::text AS "transactionId",
        NOT EXISTS (SELECT 1 FROM required_reads r LEFT JOIN pg_catalog.pg_class rel
          ON rel.oid=pg_catalog.to_regclass(pg_catalog.format('public.%I',r.table_name))
          WHERE rel.oid IS NULL OR rel.relkind<>'r' OR rel.relpersistence<>'p' OR rel.relispartition
            OR rel.relrowsecurity OR rel.relforcerowsecurity
            OR EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhparent=rel.oid OR i.inhrelid=rel.oid)
            OR pg_catalog.has_column_privilege(current_user::regrole::oid,rel.oid,r.column_name,'SELECT') IS DISTINCT FROM TRUE) AS "completeReads",
        EXISTS (SELECT 1 FROM public."Contract" other
          WHERE other."projectId"=p."id" AND other."id"<>c."id" AND other."voidedAt" IS NULL) AS "otherContract",
        EXISTS (SELECT 1 FROM public."ProjectAffiliateContractFact" f WHERE f."projectId"=p."id") AS "affiliateFact",
        EXISTS (SELECT 1 FROM public."ContractEconomicReview" r WHERE r."projectId"=p."id"
          AND ('contract:'||c."id") IN (r."leftSourceRef",r."rightSourceRef")) AS "relatedReview"
      FROM public."ContractVersion" v JOIN public."Contract" c ON c."id"=v."contractId"
      JOIN public."Project" p ON p."id"=c."projectId"
      CROSS JOIN public.jg_contract_direct_archive_completion_binding_v1 b
      JOIN pg_catalog.pg_database db ON db.datname=pg_catalog.current_database()
      CROSS JOIN LATERAL (SELECT public.jg_contract_direct_pending_input_v1(v."id") AS input) q
      WHERE b.tableoid=${completionOid}::pg_catalog.oid
        AND b."protocolVersion"=1 AND b."recipeVersion"='contract-direct-archive-completion-dispatch-v1/1'
        AND b."databaseOid"=db.oid AND b."applicationRoleOid"=current_user::regrole::oid
        AND current_user=session_user AND pg_catalog.current_setting('session_replication_role')='origin'
        AND v."id"=${source.versionId} AND c."id"=${source.contractId} AND p."id"=${source.projectId}
        AND c."ownerUserId"=${source.actor} AND c."voidedAt" IS NULL
        AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NULL
        AND v."status"='draft' AND v."versionNo"=1 AND v."changeType"='original' AND v."numericProtocolVersion"=2
        AND v."firstSubmittedAt" IS NULL AND v."effectiveAt" IS NULL AND v."endedAt" IS NULL
        AND v."draftData"#>'{directSigningInput,protocolVersion}'='1'::jsonb
        AND v."draftData"#>>'{directSigningInput,source}'='direct_signed'
        AND v."draftData"#>>'{directSigningInput,relationship}'='outside'
        AND q.input->>'state'='complete'
        AND q.input->'sourceRevision'=to_jsonb(v."draftRevision")
    `);
  } catch {
    unavailable();
  }
  const row = rows.length === 1 ? rows[0] : null;
  if (!row || row.completeReads !== true || row.completionOid !== completionOid
    || row.contractId !== source.contractId || row.versionId !== source.versionId || row.projectId !== source.projectId
    || row.sourceRevision !== source.sourceRevision || row.inputSha256 !== source.inputSha256
    || !(["databaseOid","sessionRoleOid","currentRoleOid","backendPid","transactionId"] as const).every(key => row[key] === anchor[key])
    || [row.otherContract, row.affiliateFact, row.relatedReview].some(value => typeof value !== "boolean")) unavailable();
  if (row.otherContract || row.affiliateFact || row.relatedReview) {
    throw new ConflictException("本项目另有合同或履约来源，当前不在可直接登记范围，请先核对履约资料");
  }
}
