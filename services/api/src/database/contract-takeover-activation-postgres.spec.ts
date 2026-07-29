import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { ContractTakeoverActivationService } from "../contract-takeover/contract-takeover-activation.service";

const TEST_DATABASE = "jiangkong_contract_takeover_task1_20260729";

export function contractTakeoverActivationDatabaseUrl(
  value: string | undefined
) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("历史接管激活测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("历史接管激活测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("historical takeover activation PostgreSQL integration", () => {
  it("rejects a non-local or wrong database target", () => {
    expect(() =>
      contractTakeoverActivationDatabaseUrl(
        "postgresql://user:pass@example.com/production"
      )
    ).toThrow("历史接管激活测试拒绝非本机专用数据库");
  });

  const integrationTest =
    process.env.RUN_CONTRACT_TAKEOVER_ACTIVATION_POSTGRES === "1"
      ? it
      : it.skip;

  integrationTest(
    "atomically activates one opening settlement, payment facts, balance and audit without approval records",
    async () => {
      const client = new PrismaClient({
        datasources: {
          db: {
            url: contractTakeoverActivationDatabaseUrl(
              process.env.CONTRACT_TAKEOVER_ACTIVATION_DATABASE_URL
            )
          }
        }
      });
      const suffix = randomUUID();
      const ids = {
        actor: `activation-actor-${suffix}`,
        project: `activation-project-${suffix}`,
        contract: `activation-contract-${suffix}`,
        version: `activation-version-${suffix}`,
        terms: `activation-terms-${suffix}`,
        takeover: `activation-takeover-${suffix}`,
        payment1: `activation-payment-1-${suffix}`,
        payment2: `activation-payment-2-${suffix}`,
        voucher1: `activation-voucher-1-${suffix}`,
        voucher2: `activation-voucher-2-${suffix}`,
        settlementEvidence: `activation-settlement-evidence-${suffix}`,
        excessEvidence: `activation-excess-evidence-${suffix}`,
        directContract: `activation-direct-contract-${suffix}`,
        directVersion: `activation-direct-version-${suffix}`,
        directTerms: `activation-direct-terms-${suffix}`,
        directTakeover: `activation-direct-takeover-${suffix}`
      };
      const rollback = new Error("ROLLBACK_ACTIVATION_TEST");
      const activation = new ContractTakeoverActivationService(
        new AuditService()
      );

      try {
        await expect(
          client.$transaction(
            async (tx) => {
              await tx.user.create({
                data: {
                  id: ids.actor,
                  name: "历史激活集成测试用户"
                }
              });
              await tx.project.create({
                data: {
                  id: ids.project,
                  code: `ACT-${suffix}`,
                  name: "历史激活集成测试项目"
                }
              });
              await tx.fileObject.createMany({
                data: [
                  ids.voucher1,
                  ids.voucher2,
                  ids.settlementEvidence,
                  ids.excessEvidence
                ].map((id) => ({
                  id,
                  bucket: "test-private",
                  objectKey: `${id}.pdf`,
                  originalName: `${id}.pdf`,
                  mimeType: "application/pdf",
                  sizeBytes: 1,
                  uploadedByUserId: ids.actor
                }))
              });
              await tx.contract.create({
                data: {
                  id: ids.contract,
                  projectId: ids.project,
                  source: "historical_takeover",
                  code: `HT-ACT-${suffix}`,
                  name: "历史激活集成测试合同",
                  counterparty: "测试供应商",
                  contractTypeKey: "material_purchase"
                }
              });
              await tx.contractVersion.create({
                data: {
                  id: ids.version,
                  contractId: ids.contract,
                  versionNo: 1,
                  changeType: "historical_takeover",
                  status: "draft",
                  amountCents: 1_000n,
                  draftData: {},
                  templateSnapshot: {},
                  clauseSnapshot: {}
                }
              });
              await tx.paymentTermsVersion.create({
                data: {
                  id: ids.terms,
                  contractId: ids.contract,
                  contractVersionId: ids.version,
                  versionNo: 1,
                  status: "draft",
                  originalText: "历史付款条款"
                }
              });
              await tx.contractTakeover.create({
                data: {
                  id: ids.takeover,
                  projectId: ids.project,
                  contractId: ids.contract,
                  contractVersionId: ids.version,
                  paymentTermsVersionId: ids.terms,
                  takeoverLevel: "A",
                  takeoverStatus: "draft",
                  lifecycleStatus: "in_progress",
                  signedAt: new Date("2026-01-01T00:00:00.000Z"),
                  createdByUserId: ids.actor
                }
              });
              await tx.contractTakeoverContractFacts.create({
                data: {
                  takeoverId: ids.takeover,
                  revision: 3,
                  financeBasisRevision: 4,
                  signedAt: new Date("2026-01-01T00:00:00.000Z"),
                  historicalSettledCents: 600n,
                  performanceStatus: "performing",
                  paymentTermsSnapshot: {},
                  contractFactsSnapshot: {},
                  confirmedRevision: 3,
                  confirmedByUserId: ids.actor,
                  confirmedAt: new Date(),
                  updatedByUserId: ids.actor
                }
              });
              await tx.contractTakeoverFinanceFacts.create({
                data: {
                  takeoverId: ids.takeover,
                  revision: 2,
                  basedOnContractRevision: 3,
                  basedOnFinanceBasisRevision: 4,
                  excessTreatment: "historical_advance",
                  excessReason: "历史预付款尚未形成结算",
                  confirmedRevision: 2,
                  confirmedContractRevision: 3,
                  confirmedFinanceBasisRevision: 4,
                  confirmedByUserId: ids.actor,
                  confirmedAt: new Date(),
                  updatedByUserId: ids.actor
                }
              });
              await tx.contractTakeoverHistoricalPayment.createMany({
                data: [
                  {
                    id: ids.payment1,
                    takeoverId: ids.takeover,
                    rowKey: "row-1",
                    sequenceNo: 1,
                    amountCents: 400n,
                    paidAt: new Date("2026-01-10T00:00:00.000Z")
                  },
                  {
                    id: ids.payment2,
                    takeoverId: ids.takeover,
                    rowKey: "row-2",
                    sequenceNo: 2,
                    amountCents: 500n,
                    paidAt: new Date("2026-02-10T00:00:00.000Z")
                  }
                ]
              });
              await tx.contractTakeoverHistoricalPaymentVoucher.createMany({
                data: [
                  {
                    historicalPaymentId: ids.payment1,
                    fileId: ids.voucher1,
                    displayOrder: 1,
                    uploadedByUserId: ids.actor
                  },
                  {
                    historicalPaymentId: ids.payment2,
                    fileId: ids.voucher2,
                    displayOrder: 1,
                    uploadedByUserId: ids.actor
                  }
                ]
              });
              await tx.contractTakeoverSettlementEvidence.create({
                data: {
                  takeoverId: ids.takeover,
                  fileId: ids.settlementEvidence,
                  displayOrder: 1,
                  createdByUserId: ids.actor
                }
              });
              await tx.contractTakeoverExcessEvidence.create({
                data: {
                  takeoverId: ids.takeover,
                  fileId: ids.excessEvidence,
                  displayOrder: 1,
                  createdByUserId: ids.actor
                }
              });

              const first = await activation.tryActivateInTransaction(
                tx,
                ids.takeover,
                ids.actor,
                `activation-key-${suffix}`
              );
              const repeated = await activation.tryActivateInTransaction(
                tx,
                ids.takeover,
                ids.actor,
                `activation-key-retry-${suffix}`
              );

              expect(repeated).toEqual(first);
              expect(
                await tx.settlement.count({
                  where: { sourceTakeoverId: ids.takeover }
                })
              ).toBe(1);
              expect(
                await tx.contractTakeoverHistoricalPayment.count({
                  where: {
                    takeoverId: ids.takeover,
                    status: "activated"
                  }
                })
              ).toBe(2);
              const allocations =
                await tx.contractTakeoverHistoricalPaymentAllocation.findMany({
                  where: {
                    historicalPaymentId: {
                      in: [ids.payment1, ids.payment2]
                    }
                  },
                  orderBy: [
                    { historicalPaymentId: "asc" },
                    { allocationOrder: "asc" }
                  ]
                });
              expect(
                allocations.reduce(
                  (total, row) => total + row.amountCents,
                  0n
                )
              ).toBe(900n);
              expect(
                await tx.contractTakeoverBalanceAccount.count({
                  where: {
                    takeoverId: ids.takeover,
                    balanceType: "historical_advance"
                  }
                })
              ).toBe(1);
              expect(
                await tx.auditLog.count({
                  where: {
                    action: "contract_takeover.activate",
                    businessId: ids.takeover
                  }
                })
              ).toBe(1);
              expect(
                await tx.paymentRequest.count({
                  where: { contractId: ids.contract }
                })
              ).toBe(0);

              await tx.contract.create({
                data: {
                  id: ids.directContract,
                  projectId: ids.project,
                  source: "historical_takeover",
                  code: `HT-DIRECT-${suffix}`,
                  name: "历史无上限直接付款合同",
                  counterparty: "测试供应商",
                  contractTypeKey: "generic_contract"
                }
              });
              await tx.contractVersion.create({
                data: {
                  id: ids.directVersion,
                  contractId: ids.directContract,
                  versionNo: 1,
                  changeType: "historical_takeover",
                  status: "draft",
                  amountCents: 0n,
                  amountLimitType: "unlimited",
                  draftData: {},
                  templateSnapshot: {},
                  clauseSnapshot: {}
                }
              });
              await tx.paymentTermsVersion.create({
                data: {
                  id: ids.directTerms,
                  contractId: ids.directContract,
                  contractVersionId: ids.directVersion,
                  versionNo: 1,
                  status: "draft",
                  originalText: "历史直接付款条款"
                }
              });
              await tx.contractTakeover.create({
                data: {
                  id: ids.directTakeover,
                  projectId: ids.project,
                  contractId: ids.directContract,
                  contractVersionId: ids.directVersion,
                  paymentTermsVersionId: ids.directTerms,
                  takeoverLevel: "A",
                  takeoverStatus: "draft",
                  lifecycleStatus: "in_progress",
                  signedAt: new Date("2026-01-01T00:00:00.000Z"),
                  createdByUserId: ids.actor
                }
              });
              await tx.contractTakeoverContractFacts.create({
                data: {
                  takeoverId: ids.directTakeover,
                  revision: 1,
                  financeBasisRevision: 1,
                  signedAt: new Date("2026-01-01T00:00:00.000Z"),
                  historicalSettledCents: 0n,
                  zeroSettlementDeclared: true,
                  performanceStatus: "performing",
                  paymentTermsSnapshot: {},
                  contractFactsSnapshot: {},
                  confirmedRevision: 1,
                  confirmedByUserId: ids.actor,
                  confirmedAt: new Date(),
                  updatedByUserId: ids.actor
                }
              });
              await tx.contractTakeoverFinanceFacts.create({
                data: {
                  takeoverId: ids.directTakeover,
                  revision: 1,
                  basedOnContractRevision: 1,
                  basedOnFinanceBasisRevision: 1,
                  zeroPaymentDeclared: true,
                  confirmedRevision: 1,
                  confirmedContractRevision: 1,
                  confirmedFinanceBasisRevision: 1,
                  confirmedByUserId: ids.actor,
                  confirmedAt: new Date(),
                  updatedByUserId: ids.actor
                }
              });

              await expect(
                activation.tryActivateInTransaction(
                  tx,
                  ids.directTakeover,
                  ids.actor,
                  `activation-direct-key-${suffix}`
                )
              ).resolves.toMatchObject({
                activated: true,
                historicalInitialSettlementId: null
              });
              expect(
                await tx.settlement.count({
                  where: { sourceTakeoverId: ids.directTakeover }
                })
              ).toBe(0);
              expect(
                await tx.contractTakeoverBalanceAccount.count({
                  where: { takeoverId: ids.directTakeover }
                })
              ).toBe(0);
              throw rollback;
            },
            {
              isolationLevel:
                Prisma.TransactionIsolationLevel.Serializable
            }
          )
        ).rejects.toBe(rollback);
      } finally {
        await client.$disconnect();
      }
    },
    30_000
  );
});
