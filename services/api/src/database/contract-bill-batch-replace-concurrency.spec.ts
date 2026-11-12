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
      // Keep each run's data separate while using the column definitions and
      // uniqueness rules from the migrated database used by this gate.
      for (const table of [
        "Contract", "ContractTakeover", "ContractFormalFile", "ContractSealTask",
        "ContractArchiveFile", "Settlement", "PaymentRequest", "ContractVersion",
        "ContractBill", "ContractBillRow", "ContractBillRowLineage", "SettlementLine",
        "AuditLog", "ContractGeneratedDocument"
      ]) {
        await admin.$executeRawUnsafe(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING INDEXES)`
        );
      }
      await first.contract.create({ data: { id: "contract-1", projectId: "project-1", name: "合同", counterparty: "甲方", ownerUserId: "owner-1" } });
      await first.contractVersion.create({ data: {
        id: "version-1", contractId: "contract-1", versionNo: 1, changeType: "original", status: "draft",
        amountCents: 0n, draftRevision: 1, pricingNature: "fixed_total", amountSource: "bill_sum", amountLimitType: "capped",
        taxMode: "single_rate", defaultTaxRatePercent: 13, draftData: {}, templateSnapshot: {}, clauseSnapshot: []
      } });
      await first.contractBill.create({ data: {
        id: "bill-1", contractVersionId: "version-1", billKey: "main", name: "清单", amountRole: "included",
        pricingMode: "tax_inclusive", quantityScale: 2, unitPriceScale: 2, schemaSnapshot: { columns: [] }, revision: 1
      } });
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
