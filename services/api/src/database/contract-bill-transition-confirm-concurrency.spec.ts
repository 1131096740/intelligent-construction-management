import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { ContractBillTransitionService } from "../contract-bill/contract-bill-transition.service";

const TEST_DATABASE = "jiangkong_contract_bill_batch_test";
const CONTRACT_DIRECTOR_ID = "seed-user-contract-director";
const PROJECT_ID = "seed-project-jgxm-001";

export function contractBillTransitionConfirmDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("跨版本映射确认集成测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    || url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("跨版本映射确认集成测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("contract bill transition confirmation PostgreSQL evidence", () => {
  const integrationTest = process.env.RUN_CONTRACT_BILL_TRANSITION_CONFIRM_DATABASE === "1" ? it : it.skip;

  integrationTest("allows exactly one director confirmation for the same mapping group", async () => {
    const databaseUrl = contractBillTransitionConfirmDatabaseUrl(
      process.env.CONTRACT_BILL_TRANSITION_CONFIRM_DATABASE_URL
    );
    const suffix = randomUUID();
    const ids = {
      contract: `transition-confirm-contract-${suffix}`,
      sourceVersion: `transition-confirm-source-version-${suffix}`,
      targetVersion: `transition-confirm-target-version-${suffix}`,
      sourceBill: `transition-confirm-source-bill-${suffix}`,
      targetBill: `transition-confirm-target-bill-${suffix}`,
      sourceRow: `transition-confirm-source-row-${suffix}`,
      targetRow: `transition-confirm-target-row-${suffix}`,
      paymentTerms: `transition-confirm-terms-${suffix}`,
      settlement: `transition-confirm-settlement-${suffix}`,
      settlementLine: `transition-confirm-line-${suffix}`
    };
    const first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const service = (client: PrismaClient) => new ContractBillTransitionService(
      client as never,
      new AuditService()
    );

    try {
      await first.contract.create({
        data: {
          id: ids.contract,
          projectId: PROJECT_ID,
          name: "跨版本映射并发验证合同",
          counterparty: "验证单位",
          ownerUserId: "seed-user-contract-staff"
        }
      });
      await first.contractVersion.createMany({
        data: [
          {
            id: ids.sourceVersion,
            contractId: ids.contract,
            versionNo: 1,
            changeType: "original",
            status: "effective",
            amountCents: 10_000n,
            draftRevision: 1,
            settlementMode: "settlement_required",
            settlementModeSource: "rule",
            draftData: {},
            templateSnapshot: {},
            clauseSnapshot: []
          },
          {
            id: ids.targetVersion,
            contractId: ids.contract,
            versionNo: 2,
            changeType: "change",
            status: "draft",
            amountCents: 10_000n,
            baseVersionId: ids.sourceVersion,
            draftRevision: 4,
            settlementMode: "settlement_required",
            settlementModeSource: "inherited",
            draftData: {},
            templateSnapshot: {},
            clauseSnapshot: []
          }
        ]
      });
      await first.paymentTermsVersion.create({
        data: {
          id: ids.paymentTerms,
          contractId: ids.contract,
          contractVersionId: ids.sourceVersion,
          versionNo: 1,
          status: "effective",
          originalText: "按已生效结算支付"
        }
      });
      await first.contractBill.createMany({
        data: [
          {
            id: ids.sourceBill,
            contractVersionId: ids.sourceVersion,
            billKey: "main",
            name: "来源清单",
            amountRole: "included",
            pricingMode: "tax_inclusive",
            quantityScale: 2,
            unitPriceScale: 2,
            schemaSnapshot: {}
          },
          {
            id: ids.targetBill,
            contractVersionId: ids.targetVersion,
            billKey: "main",
            name: "目标清单",
            amountRole: "included",
            pricingMode: "tax_inclusive",
            quantityScale: 2,
            unitPriceScale: 2,
            schemaSnapshot: {}
          }
        ]
      });
      await first.contractBillRow.createMany({
        data: [
          {
            id: ids.sourceRow,
            contractBillId: ids.sourceBill,
            rowKey: "source-row",
            sortOrder: 1,
            itemName: "来源钢筋",
            unit: "t",
            quantity: "30",
            unitPrice: "100",
            customData: {}
          },
          {
            id: ids.targetRow,
            contractBillId: ids.targetBill,
            rowKey: "target-row",
            sortOrder: 1,
            itemName: "承接钢筋",
            unit: "t",
            quantity: "30",
            unitPrice: "100",
            customData: {}
          }
        ]
      });
      await first.settlement.create({
        data: {
          id: ids.settlement,
          projectId: PROJECT_ID,
          contractId: ids.contract,
          contractVersionId: ids.sourceVersion,
          paymentTermsVersionId: ids.paymentTerms,
          code: `transition-confirm-${suffix}`,
          periodLabel: "并发确认验证",
          status: "effective",
          amountCents: 3_000n,
          payableAmountCents: 3_000n
        }
      });
      await first.settlementLine.create({
        data: {
          id: ids.settlementLine,
          settlementId: ids.settlement,
          contractBillRowId: ids.sourceRow,
          sourceType: "contract_bill_row",
          name: "来源钢筋",
          unit: "t",
          quantity: "30",
          unitPriceCents: 100n,
          amountCents: 3_000n,
          sortOrder: 1
        }
      });
      await first.contractBillRowTransition.create({
        data: {
          contractId: ids.contract,
          fromContractVersionId: ids.sourceVersion,
          toContractVersionId: ids.targetVersion,
          sourceContractBillRowId: ids.sourceRow,
          targetContractBillRowId: ids.targetRow,
          relationType: "one_to_one",
          matchBasis: "manual",
          sourceSettledQuantityAllocated: "30",
          targetOpeningQuantity: "30",
          settledAmountAllocatedCents: 3_000n,
          status: "draft"
        }
      });

      const results = await Promise.allSettled([
        service(first).confirmDraftMappings(ids.targetVersion, CONTRACT_DIRECTOR_ID, {
          expectedTargetVersionRevision: 4
        }),
        service(second).confirmDraftMappings(ids.targetVersion, CONTRACT_DIRECTOR_ID, {
          expectedTargetVersionRevision: 4
        })
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      await expect(first.contractVersion.findUnique({ where: { id: ids.targetVersion } })).resolves.toMatchObject({
        draftRevision: 5
      });
      await expect(first.contractBillRowTransition.findFirst({
        where: {
          fromContractVersionId: ids.sourceVersion,
          toContractVersionId: ids.targetVersion,
          sourceContractBillRowId: ids.sourceRow,
          targetContractBillRowId: ids.targetRow
        }
      })).resolves.toMatchObject({
        status: "confirmed",
        confirmedByUserId: CONTRACT_DIRECTOR_ID
      });
      await expect(first.auditLog.count({
        where: {
          action: "contract.bill.transition.confirm",
          businessId: ids.targetVersion
        }
      })).resolves.toBe(1);
    } finally {
      await first.contractBillRowTransition.deleteMany({
        where: { contractId: ids.contract }
      });
      await first.settlementLine.deleteMany({ where: { settlementId: ids.settlement } });
      await first.settlement.deleteMany({ where: { id: ids.settlement } });
      await first.contractBillRow.deleteMany({ where: { id: { in: [ids.sourceRow, ids.targetRow] } } });
      await first.contractBill.deleteMany({ where: { id: { in: [ids.sourceBill, ids.targetBill] } } });
      await first.paymentTermsVersion.deleteMany({ where: { id: ids.paymentTerms } });
      await first.contractVersion.deleteMany({ where: { id: { in: [ids.sourceVersion, ids.targetVersion] } } });
      await first.contract.deleteMany({ where: { id: ids.contract } });
      await first.auditLog.deleteMany({ where: { businessId: ids.targetVersion } });
      await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
    }
  }, 30_000);
});
