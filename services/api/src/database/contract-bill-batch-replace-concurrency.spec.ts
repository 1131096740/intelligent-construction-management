import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { ContractBillService } from "../contract-bill/contract-bill.service";

const TEST_DATABASE = "jiangkong_contract_bill_batch_test";

export function contractBillBatchDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") throw new Error("合同清单整表集成测试必须连接非生产专用数据库");
  const url = new URL(value);
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname) || url.pathname !== `/${TEST_DATABASE}`) {
    throw new Error("合同清单整表集成测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("contract bill batch replace PostgreSQL evidence", () => {
  const integrationTest = process.env.RUN_CONTRACT_BILL_BATCH_DATABASE === "1" ? it : it.skip;

  integrationTest("uses JSONB receipt, serializes writes, and rolls back on audit failure", async () => {
    const databaseUrl = contractBillBatchDatabaseUrl(process.env.CONTRACT_BILL_BATCH_DATABASE_URL);
    const schema = `contract_bill_batch_${randomUUID().replace(/-/gu, "")}`;
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const url = new URL(databaseUrl); url.searchParams.set("schema", schema);
    const first = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const second = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const input = { expectedBillRevision: 1, idempotencyKey: "postgres-batch-save-001", rows: [{ clientRowKey: "local-1", sortOrder: 0, itemName: "钢筋", unit: "t", quantity: "1", unitPrice: "100", taxRatePercent: "13", customData: {} }] };
    const service = (client: PrismaClient, audit = new AuditService(client as never)) => new ContractBillService(client as never, audit);
    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await first.$executeRawUnsafe(`CREATE TABLE "Contract" ("id" text primary key,"projectId" text not null,"source" text not null default 'system',"code" text,"name" text not null,"counterparty" text not null,"companyEntityId" text,"companyEntityName" text,"contractTypeKey" text,"ownerUserId" text,"businessScenarioId" text,"scenarioTemplateMappingId" text,"scenarioSnapshot" jsonb,"temporaryCode" text,"settlementClosedAt" timestamptz,"finalSettlementId" text,"voidedAt" timestamptz,"voidedReason" text,"createdAt" timestamptz not null default now(),"updatedAt" timestamptz not null default now())`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractTakeover" ("id" text primary key,"contractVersionId" text not null)`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractFormalFile" ("id" text primary key,"contractVersionId" text not null,"purpose" text not null,"status" text not null)`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractSealTask" ("id" text primary key,"contractVersionId" text not null,"status" text not null)`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractArchiveFile" ("id" text primary key,"contractVersionId" text not null)`);
      await first.$executeRawUnsafe(`CREATE TABLE "Settlement" ("id" text primary key,"contractVersionId" text not null)`);
      await first.$executeRawUnsafe(`CREATE TABLE "PaymentRequest" ("id" text primary key,"contractVersionId" text not null)`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractVersion" ("id" text primary key,"contractId" text not null,"versionNo" integer not null,"changeType" text not null,"status" text not null,"amountCents" bigint not null,"estimatedAmountCents" bigint,"baseVersionId" text,"supersedesVersionId" text,"copiedFromContractVersionId" text,"changeReason" text,"changeDirection" text,"changeAmountCents" bigint,"originalBaseAmountCents" bigint,"cumulativeIncreaseCents" bigint not null default 0,"cumulativeDecreaseCents" bigint not null default 0,"draftRevision" integer not null,"pricingNature" text not null,"amountSource" text not null,"amountAdjustmentReason" text,"amountLimitType" text not null,"effectiveAt" timestamptz,"businessTemplateVersionId" text,"layoutTemplateVersionId" text,"invoiceType" text,"taxMode" text not null,"defaultTaxRatePercent" numeric,"taxFactStatus" text not null default 'unconfirmed',"taxFactSource" text,"taxFactExplanation" text,"taxFactEvidenceFileId" text,"taxFactRevision" integer not null default 0,"taxFactsFrozenAt" timestamptz,"contractGovernanceVersion" integer,"companyEntityIdSnapshot" text,"companyEntityVersionId" text,"companyEntityNameSnapshot" text,"companyEntityCreditCodeSnapshot" text,"companyEntityRegisteredAddressSnapshot" text,"settlementMode" text,"settlementModeSource" text,"settlementModeConfirmedByUserId" text,"settlementModeConfirmedAt" timestamptz,"draftData" jsonb not null default '{}',"templateSnapshot" jsonb not null default '{}',"clauseSnapshot" jsonb not null default '[]',"readinessSnapshot" jsonb,"endedAt" timestamptz,"abandonedAt" timestamptz,"abandonedByUserId" text,"abandonReason" text,"createdAt" timestamptz not null default now(),"updatedAt" timestamptz not null default now())`);
      await first.$executeRawUnsafe(`ALTER TABLE "ContractVersion" ADD COLUMN "firstSubmittedAt" timestamptz, ADD COLUMN "latestDraftPreviewDocumentId" text, ADD COLUMN "signingSubjectType" text NOT NULL DEFAULT 'our_company', ADD COLUMN "affiliateAssignmentId" text, ADD COLUMN "affiliateBusinessPartyVersionId" text, ADD COLUMN "affiliateNameSnapshot" text, ADD COLUMN "affiliateCreditCodeSnapshot" text`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractBill" ("id" text primary key,"contractVersionId" text not null,"billKey" text not null,"name" text not null,"amountRole" text not null,"pricingMode" text not null,"quantityScale" integer not null,"unitPriceScale" integer not null,"schemaSnapshot" jsonb not null,"sourceExcelFileId" text,"revision" integer not null,"taxInclusiveAmountCents" bigint not null default 0,"taxExclusiveAmountCents" bigint not null default 0,"taxAmountCents" bigint not null default 0,"createdAt" timestamptz not null default now(),"updatedAt" timestamptz not null default now())`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractBillRow" ("id" text primary key,"contractBillId" text not null,"rowKey" text not null,"sortOrder" integer not null,"itemCode" text,"itemName" text not null,"specification" text,"unit" text not null,"quantity" numeric,"unitPrice" numeric,"taxRate" numeric,"taxRateSource" text not null,"pricingFactStatus" text not null,"precisionPolicy" text not null,"taxInclusiveAmountCents" bigint,"taxExclusiveAmountCents" bigint,"taxAmountCents" bigint,"taxExclusiveUnitPrice" numeric,"isProvisional" boolean not null,"settlementBasis" text,"lineageId" text,"remainderDisposition" text,"remainderDispositionReason" text,"remainderDispositionByUserId" text,"remainderDispositionAt" timestamptz,"customData" jsonb not null,"createdAt" timestamptz not null default now(),"updatedAt" timestamptz not null default now(), unique("contractBillId","rowKey"))`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractBillRowLineage" ("id" text primary key,"contractId" text not null,"createdInContractVersionId" text not null,"status" text not null,"createdByUserId" text not null,"createdAt" timestamptz not null default now(),"updatedAt" timestamptz not null default now())`);
      await first.$executeRawUnsafe(`CREATE TABLE "SettlementLine" ("id" text primary key,"contractBillRowId" text)`);
      await first.$executeRawUnsafe(`CREATE TABLE "AuditLog" ("id" text primary key,"actorUserId" text,"action" text not null,"businessType" text,"businessId" text,"ipAddress" text,"userAgent" text,"metadata" jsonb,"createdAt" timestamptz not null default now())`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractGeneratedDocument" ("id" text primary key,"contractVersionId" text not null,"layoutTemplateVersionId" text not null,"purpose" text not null,"status" text not null,"sourceRevision" integer not null,"inputSnapshot" jsonb not null,"idempotencyKey" text not null,"engineVersion" text not null,"createdByUserId" text not null,"createdAt" timestamptz not null default now(),"updatedAt" timestamptz not null default now())`);
      await first.$executeRaw`INSERT INTO "Contract" ("id","projectId","name","counterparty","ownerUserId") VALUES ('contract-1','project-1','合同','甲方','owner-1')`;
      await first.$executeRaw`INSERT INTO "ContractVersion" ("id","contractId","versionNo","changeType","status","amountCents","draftRevision","pricingNature","amountSource","amountLimitType","taxMode","defaultTaxRatePercent") VALUES ('version-1','contract-1',1,'original','draft',0,1,'fixed_total','bill_sum','capped','single_rate',13)`;
      await first.$executeRaw`INSERT INTO "ContractBill" ("id","contractVersionId","billKey","name","amountRole","pricingMode","quantityScale","unitPriceScale","schemaSnapshot","revision") VALUES ('bill-1','version-1','main','清单','included','tax_inclusive',2,2,'{"columns":[]}',1)`;
      await expect(service(first).replaceRows('bill-1','owner-1',input)).resolves.toBeDefined();
      await expect(service(first).replaceRows('bill-1','owner-1',input)).resolves.toBeDefined();
      expect(await first.contractBill.findUnique({ where: { id: 'bill-1' } })).toMatchObject({ revision: 2 });
      expect(await first.auditLog.count({ where: { action: 'contract.bill.rows.replace' } })).toBe(1);
      const concurrent = await Promise.allSettled([
        service(first).replaceRows('bill-1','owner-1',{ ...input, idempotencyKey: 'postgres-batch-save-002', expectedBillRevision: 2, rows: [{ ...input.rows[0], itemName: '并发甲' }] }),
        service(second).replaceRows('bill-1','owner-1',{ ...input, idempotencyKey: 'postgres-batch-save-003', expectedBillRevision: 2, rows: [{ ...input.rows[0], itemName: '并发乙' }] })
      ]);
      expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(await first.contractBill.findUnique({ where: { id: 'bill-1' } })).toMatchObject({ revision: 3 });
      expect(await first.auditLog.count({ where: { action: 'contract.bill.rows.replace' } })).toBe(2);
      const beforeRollbackRows = await first.contractBillRow.findMany({ where: { contractBillId: 'bill-1' } });
      const failingAudit = { record: async () => { throw new Error('audit failure'); } };
      await expect(service(first, failingAudit as never).replaceRows('bill-1','owner-1',{ ...input, idempotencyKey: 'postgres-batch-save-004', expectedBillRevision: 3, rows: [{ ...input.rows[0], itemName: '回滚' }] })).rejects.toThrow('audit failure');
      expect(await first.contractBill.findUnique({ where: { id: 'bill-1' } })).toMatchObject({ revision: 3 });
      expect(await first.contractBillRow.findMany({ where: { contractBillId: 'bill-1' } })).toEqual(beforeRollbackRows);
      expect(await first.auditLog.count({ where: { action: 'contract.bill.rows.replace' } })).toBe(2);
    } finally {
      await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  }, 30_000);
});
