import type { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { RegisteredPgFixturePlan } from "./registered-payment-postgres.fixture";

export const payment261SeedProfile = "TASK16_PAYMENT261_RUNTIME_V1" as const;

const bindSeed = `
WITH identity AS (
  SELECT pg_catalog.pg_backend_pid() AS pid, pg_catalog.pg_current_xact_id()::text AS xid
)
SELECT CASE WHEN COALESCE(pg_catalog.current_setting('jg_task16.payment_seed_v1', true), '') = ''
  AND current_user = 'jg_task01_owner' AND session_user = 'jg_task01_owner'
  AND pg_catalog.current_database() = $2::text
  AND EXISTS (SELECT FROM pg_catalog.pg_stat_ssl ssl WHERE ssl.pid=identity.pid AND ssl.ssl)
  AND pg_catalog.current_setting('transaction_isolation') = 'serializable'
  THEN pg_catalog.set_config('jg_task16.payment_seed_v1',
    ($1::jsonb || pg_catalog.jsonb_build_object('pid', pid, 'xid', xid, 'database', $2::text))::text, true) IS NOT NULL
  ELSE false END AS bound
FROM identity`;

// PostgreSQL cannot bind variables inside a DO body. The previous statement
// binds only JSON data into a transaction-local setting; no value becomes SQL.
const applySeed = `
DO $jg_task16_seed$
DECLARE
  seed jsonb := NULLIF(pg_catalog.current_setting('jg_task16.payment_seed_v1', true), '')::jsonb;
  ids jsonb := seed->'ids';
  run_key text := seed->>'runId';
  instant timestamp(3) := (seed->>'openingDate')::date::timestamp;
  party_name text := 'T16施工企业' || run_key;
  position_id text;
  company_a public."CompanyEntity"%ROWTYPE;
  company_b public."CompanyEntity"%ROWTYPE;
  party public."BusinessParty"%ROWTYPE;
  party_version public."BusinessPartyVersion"%ROWTYPE;
  assignment public."ProjectAffiliateAssignment"%ROWTYPE;
  marker bigint;
BEGIN
  IF seed IS NULL OR seed->>'database' IS DISTINCT FROM pg_catalog.current_database()
    OR (seed->>'pid')::integer IS DISTINCT FROM pg_catalog.pg_backend_pid()
    OR seed->>'xid' IS DISTINCT FROM pg_catalog.pg_current_xact_id()::text
    OR current_user <> 'jg_task01_owner' OR session_user <> 'jg_task01_owner'
    OR pg_catalog.current_setting('transaction_isolation') <> 'serializable' THEN
    RAISE EXCEPTION 'PG_FIXTURE_SEED_BINDING';
  END IF;

  INSERT INTO public."User" ("id","phone","name","passwordHash","isActive","mustChangePassword","updatedAt")
    VALUES (ids->>'actor',seed->>'phone','PG合成财务'||run_key,seed->>'passwordHash',true,false,pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()));
  SELECT "id" INTO position_id FROM public."Position" WHERE "key"='finance_staff';
  IF NOT FOUND THEN
    INSERT INTO public."Position" ("id","key","name","updatedAt")
      VALUES (seed->>'positionId','finance_staff','财务人员',pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())) RETURNING "id" INTO STRICT position_id;
  END IF;
  INSERT INTO public."UserPosition" ("id","userId","positionId","projectId")
    VALUES (seed->>'userPositionId',ids->>'actor',position_id,NULL);

  INSERT INTO public."CompanyEntity" ("id","name","unifiedSocialCreditCode","dataStatus","currentVersionNo","isActive","updatedAt")
    VALUES (ids->>'companyA','PG合成公司AA'||run_key,seed->>'creditA','complete',1,true,pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()));
  INSERT INTO public."CompanyEntityVersion" ("id","companyEntityId","versionNo","name","unifiedSocialCreditCode","isActive","action","actorUserId")
    VALUES (ids->>'companyVersionA',ids->>'companyA',1,'PG合成公司AA'||run_key,seed->>'creditA',true,'create',ids->>'actor');
  INSERT INTO public."CompanyEntity" ("id","name","unifiedSocialCreditCode","dataStatus","currentVersionNo","isActive","updatedAt")
    VALUES (ids->>'companyB','PG合成公司BB'||run_key,seed->>'creditB','complete',1,true,pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()));
  INSERT INTO public."CompanyEntityVersion" ("id","companyEntityId","versionNo","name","unifiedSocialCreditCode","isActive","action","actorUserId")
    VALUES (ids->>'companyVersionB',ids->>'companyB',1,'PG合成公司BB'||run_key,seed->>'creditB',true,'create',ids->>'actor');

  INSERT INTO public."BusinessParty" ("id","type","name","normalizedName","unifiedSocialCreditCode","status","createdByUserId","updatedAt")
    VALUES (ids->>'constructionEnterpriseParty','organization',party_name,party_name,NULL,'active',ids->>'actor',pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()))
    RETURNING * INTO STRICT party;
  INSERT INTO public."BusinessPartyVersion" ("id","businessPartyId","versionNo","snapshot","createdByUserId")
    VALUES (ids->>'constructionEnterpriseVersion',party."id",1,
      pg_catalog.jsonb_build_object('type','organization','name',party_name,'attachments','[]'::jsonb),ids->>'actor')
    RETURNING * INTO STRICT party_version;
  IF party."id" IS DISTINCT FROM ids->>'constructionEnterpriseParty'
    OR party."type" IS DISTINCT FROM 'organization' OR party."status" IS DISTINCT FROM 'active'
    OR party."name" IS DISTINCT FROM party_name OR party."normalizedName" IS DISTINCT FROM party_name
    OR party."unifiedSocialCreditCode" IS NOT NULL
    OR party_version."id" IS DISTINCT FROM ids->>'constructionEnterpriseVersion'
    OR party_version."businessPartyId" IS DISTINCT FROM party."id" OR party_version."versionNo" IS DISTINCT FROM 1
    OR party_version."snapshot" IS DISTINCT FROM pg_catalog.jsonb_build_object('type','organization','name',party_name,'attachments','[]'::jsonb) THEN
    RAISE EXCEPTION 'PG_FIXTURE_CONSTRUCTION_PARTY';
  END IF;

  INSERT INTO public."Project" ("id","code","name","isActive","operatingLedgerEffectiveDate","updatedAt")
    VALUES (ids->>'project','T16-'||run_key||'-P','PG合成项目'||run_key,true,NULL,pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()));
  INSERT INTO public."ProjectAffiliateAssignment" ("id","projectId","businessPartyId","businessPartyVersionId",
      "affiliateNameSnapshot","affiliateCreditCodeSnapshot","effectiveFrom","endedAt","changeReason","assignedByUserId","updatedAt")
    VALUES (ids->>'constructionEnterpriseAssignment',ids->>'project',party."id",party_version."id",
      party_name,NULL,instant,NULL,'Task16隔离合成前置',ids->>'actor',pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()));
  SELECT * INTO STRICT assignment FROM public."ProjectAffiliateAssignment"
    WHERE "projectId"=ids->>'project' AND "endedAt" IS NULL;
  IF assignment."id" IS DISTINCT FROM ids->>'constructionEnterpriseAssignment'
    OR assignment."businessPartyId" IS DISTINCT FROM party."id" OR assignment."businessPartyVersionId" IS DISTINCT FROM party_version."id"
    OR assignment."affiliateNameSnapshot" IS DISTINCT FROM party_name OR assignment."affiliateCreditCodeSnapshot" IS NOT NULL
    OR assignment."effectiveFrom" IS DISTINCT FROM instant OR assignment."assignedByUserId" IS DISTINCT FROM ids->>'actor' THEN
    RAISE EXCEPTION 'PG_FIXTURE_CONSTRUCTION_ASSIGNMENT';
  END IF;

  SELECT * INTO STRICT company_a FROM public."CompanyEntity" WHERE "id"=ids->>'companyA';
  SELECT * INTO STRICT company_b FROM public."CompanyEntity" WHERE "id"=ids->>'companyB';
  INSERT INTO public."Contract" ("id","projectId","code","name","counterparty","contractTypeKey","companyEntityId","companyEntityName","ownerUserId","updatedAt")
    VALUES (ids->>'contract',ids->>'project','T16-'||run_key||'-HT','PG合成材料合同','PG合成供应商','material_purchase',
      company_a."id",company_a."name",ids->>'actor',pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()));
  SELECT "revision" INTO marker FROM public."RegisteredContractHistoryRevision" WHERE "contractId"=ids->>'contract';
  IF marker IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'PG_FIXTURE_AUTOMATIC_HISTORY_MARKER_REQUIRED'; END IF;
  INSERT INTO public."ContractVersion" ("id","contractId","versionNo","changeType","status","effectiveAt","amountCents",
      "signingSubjectType","companyEntityIdSnapshot","companyEntityVersionId","companyEntityNameSnapshot",
      "companyEntityCreditCodeSnapshot","draftData","templateSnapshot","clauseSnapshot","updatedAt")
    VALUES (ids->>'version',ids->>'contract',1,'original','effective',instant,10000,'our_company',
      company_a."id",ids->>'companyVersionA',company_a."name",company_a."unifiedSocialCreditCode",
      '{}'::jsonb,'{}'::jsonb,'{}'::jsonb,pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()));
  INSERT INTO public."PaymentTermsVersion" ("id","contractId","contractVersionId","versionNo","status","originalText","updatedAt")
    VALUES (ids->>'terms',ids->>'contract',ids->>'version',1,'effective','按已确认结算分次付款',pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()));
  INSERT INTO public."Settlement" ("id","projectId","contractId","contractVersionId","paymentTermsVersionId","code",
      "periodLabel","status","createdAt","amountCents","payableAmountCents","paidAmountCents","updatedAt")
    VALUES (ids->>'settlement',ids->>'project',ids->>'contract',ids->>'version',ids->>'terms','T16-'||run_key||'-JS',
      '合成第一期','effective',instant,10000,10000,0,pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()));
  INSERT INTO public."PaymentRequest" ("id","projectId","settlementId","sourceType","contractId","contractVersionId",
      "paymentTermsVersionId","code","status","requestedAmountCents","approvedAmountCents","paidAmountCents","paymentSubjectType","updatedAt")
    VALUES (ids->>'payment',ids->>'project',ids->>'settlement','settlement',ids->>'contract',ids->>'version',
      ids->>'terms','T16-'||run_key||'-FK','approved_pending_payment',10000,10000,0,'our_company',pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()));
  INSERT INTO public."ApprovalInstance" ("id","flowType","businessType","businessId","status","currentNodeIndex","frozenNodes","applicantUserId","updatedAt")
    VALUES (ids->>'approvedRound','payment.approve','payment_request',ids->>'payment','approved',0,'[]'::jsonb,ids->>'actor',pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()));

  IF NOT EXISTS (
    SELECT 1 FROM public."User" u JOIN public."UserPosition" up ON up."userId"=u."id"
    JOIN public."Position" pos ON pos."id"=up."positionId"
    JOIN public."CompanyEntity" ca ON ca."id"=company_a."id"
    JOIN public."CompanyEntity" cb ON cb."id"=company_b."id"
    JOIN public."CompanyEntityVersion" va ON va."id"=ids->>'companyVersionA'
    JOIN public."CompanyEntityVersion" vb ON vb."id"=ids->>'companyVersionB'
    JOIN public."Project" p ON p."id"=ids->>'project'
    JOIN public."ProjectAffiliateAssignment" pa ON pa."id"=assignment."id" AND pa."projectId"=p."id" AND pa."endedAt" IS NULL
    JOIN public."BusinessParty" bp ON bp."id"=party."id" AND bp."id"=pa."businessPartyId"
    JOIN public."BusinessPartyVersion" bv ON bv."id"=party_version."id" AND bv."id"=pa."businessPartyVersionId"
      AND bv."businessPartyId"=bp."id"
    JOIN public."Contract" c ON c."id"=ids->>'contract' AND c."projectId"=p."id"
    JOIN public."RegisteredContractHistoryRevision" rev ON rev."contractId"=c."id"
    JOIN public."ContractVersion" v ON v."id"=ids->>'version' AND v."contractId"=c."id"
    JOIN public."PaymentTermsVersion" t ON t."id"=ids->>'terms' AND t."contractId"=c."id" AND t."contractVersionId"=v."id"
    JOIN public."Settlement" s ON s."id"=ids->>'settlement' AND s."projectId"=p."id"
      AND s."contractId"=c."id" AND s."contractVersionId"=v."id" AND s."paymentTermsVersionId"=t."id"
    JOIN public."PaymentRequest" r ON r."id"=ids->>'payment' AND r."projectId"=p."id" AND r."settlementId"=s."id"
      AND r."contractId"=c."id" AND r."contractVersionId"=v."id" AND r."paymentTermsVersionId"=t."id"
    JOIN public."ApprovalInstance" a ON a."id"=ids->>'approvedRound' AND a."businessId"=r."id" AND a."applicantUserId"=u."id"
    WHERE u."id"=ids->>'actor' AND u."phone"=seed->>'phone' AND u."passwordHash"=seed->>'passwordHash'
      AND u."isActive" AND NOT u."mustChangePassword" AND up."projectId" IS NULL AND pos."key"='finance_staff'
      AND ca."dataStatus"='complete' AND cb."dataStatus"='complete' AND ca."isActive" AND cb."isActive"
      AND ca."currentVersionNo"=1 AND cb."currentVersionNo"=1 AND ca."name"=company_a."name" AND cb."name"=company_b."name"
      AND ca."unifiedSocialCreditCode"=seed->>'creditA' AND cb."unifiedSocialCreditCode"=seed->>'creditB'
      AND va."companyEntityId"=ca."id" AND vb."companyEntityId"=cb."id" AND va."versionNo"=1 AND vb."versionNo"=1
      AND va."unifiedSocialCreditCode"=seed->>'creditA' AND vb."unifiedSocialCreditCode"=seed->>'creditB'
      AND va."action"='create' AND vb."action"='create' AND va."isActive" AND vb."isActive"
      AND va."actorUserId"=u."id" AND vb."actorUserId"=u."id" AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NULL
      AND p."constructionEnterpriseLockedAt" IS NOT NULL AND pa."effectiveFrom"=instant AND pa."assignedByUserId"=u."id"
      AND pa."affiliateNameSnapshot"=party_name AND pa."affiliateCreditCodeSnapshot" IS NULL
      AND bp."type"='organization' AND bp."status"='active' AND bp."name"=party_name AND bp."normalizedName"=party_name
      AND bp."unifiedSocialCreditCode" IS NULL AND bv."versionNo"=1 AND bv."snapshot"=party_version."snapshot"
      AND c."companyEntityId"=company_a."id" AND c."companyEntityName"=company_a."name" AND c."ownerUserId"=u."id"
      AND c."contractTypeKey"='material_purchase' AND rev."revision"=0 AND v."status"='effective' AND v."versionNo"=1
      AND v."changeType"='original' AND v."effectiveAt"=instant AND v."amountCents"=10000 AND v."signingSubjectType"='our_company'
      AND v."companyEntityIdSnapshot"=company_a."id" AND v."companyEntityVersionId"=va."id"
      AND v."companyEntityNameSnapshot"=company_a."name" AND v."companyEntityCreditCodeSnapshot"=company_a."unifiedSocialCreditCode"
      AND t."status"='effective' AND t."versionNo"=1 AND s."status"='effective' AND s."createdAt"=instant
      AND s."amountCents"=10000 AND s."payableAmountCents"=10000 AND s."paidAmountCents"=0
      AND r."sourceType"='settlement' AND r."status"='approved_pending_payment' AND r."paymentSubjectType"='our_company'
      AND r."requestedAmountCents"=10000 AND r."approvedAmountCents"=10000 AND r."paidAmountCents"=0
      AND a."flowType"='payment.approve' AND a."businessType"='payment_request' AND a."status"='approved'
      AND a."currentNodeIndex"=0 AND a."frozenNodes"='[]'::jsonb
  ) THEN RAISE EXCEPTION 'PG_FIXTURE_SEED_READBACK'; END IF;

  PERFORM pg_catalog.set_config('jg_task16.payment_seed_v1', '', true);
END;
$jg_task16_seed$`;

export async function seedOrdinaryPayment261(
  owner: PrismaClient,
  databaseName: string,
  plan: RegisteredPgFixturePlan,
  passwordHash: string,
  creditA: string,
  creditB: string,
  check: () => void
) {
  const payload = JSON.stringify({
    runId: plan.runId, phone: plan.phone, openingDate: plan.openingDate, ids: plan.ids,
    passwordHash, creditA, creditB, positionId: randomUUID(), userPositionId: randomUUID()
  });
  const checked = async <T>(operation: () => PromiseLike<T>): Promise<T> => {
    check();
    const result = await operation();
    check();
    return result;
  };
  await checked(() => owner.$transaction(async (tx: Prisma.TransactionClient) => {
    const rows = await checked(() => tx.$queryRawUnsafe<Array<{ bound: boolean }>>(bindSeed, payload, databaseName));
    if (rows.length !== 1 || rows[0]?.bound !== true) throw new Error("PG_FIXTURE_SEED_BINDING");
    await checked(() => tx.$executeRawUnsafe(applySeed));
  }, { isolationLevel: "Serializable" }));
}
