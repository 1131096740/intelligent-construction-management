import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { ContractTakeoverBalanceService } from "../contract-takeover/contract-takeover-balance.service";
import { ContractTakeoverCorrectionService } from "../contract-takeover/contract-takeover-correction.service";

const TEST_DATABASES = new Set([
  "jiangkong_contract_takeover_task1_20260729",
  "jiangkong_contract_takeover_task8_20260729",
  "jiangkong_contract_takeover_task8_final_20260729"
]);

export function contractTakeoverCorrectionDatabaseUrl(
  value: string | undefined
) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("历史更正并发测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    !TEST_DATABASES.has(url.pathname.slice(1))
  ) {
    throw new Error("历史更正并发测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("historical takeover correction PostgreSQL concurrency", () => {
  it("rejects a non-local or wrong database target", () => {
    expect(() =>
      contractTakeoverCorrectionDatabaseUrl(
        "postgresql://user:pass@example.com/production"
      )
    ).toThrow("历史更正并发测试拒绝非本机专用数据库");
  });

  const integrationTest =
    process.env.RUN_CONTRACT_TAKEOVER_CORRECTION_CONCURRENCY === "1"
      ? it
      : it.skip;

  integrationTest(
    "allows only one supervisor application and leaves one immutable delta ledger",
    async () => {
      const databaseUrl = contractTakeoverCorrectionDatabaseUrl(
        process.env.CONTRACT_TAKEOVER_CORRECTION_DATABASE_URL
      );
      const first = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const second = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const suffix = randomUUID();
      const ids = {
        submitter: `correction-submitter-${suffix}`,
        reviewer: `correction-reviewer-${suffix}`,
        project: `correction-project-${suffix}`,
        contract: `correction-contract-${suffix}`,
        version: `correction-version-${suffix}`,
        terms: `correction-terms-${suffix}`,
        takeover: `correction-takeover-${suffix}`,
        account: `correction-account-${suffix}`,
        file: `correction-file-${suffix}`
      };
      const audit = new AuditService();
      const balance = new ContractTakeoverBalanceService(audit);
      const auth = {
        confirmPassword: jest.fn().mockResolvedValue(undefined)
      };
      const files = {
        assertCanAttachUnlinkedFile: jest
          .fn()
          .mockResolvedValue({ id: ids.file })
      };
      const firstService = new ContractTakeoverCorrectionService(
        first as never,
        audit,
        auth as never,
        files as never,
        balance
      );
      const secondService =
        new ContractTakeoverCorrectionService(
          second as never,
          audit,
          auth as never,
          files as never,
          balance
        );

      try {
        await seedCorrectionFacts(first, ids, suffix);
        const submitted = await firstService.submit(
          ids.project,
          ids.takeover,
          ids.submitter,
          {
            correctionScope: "abnormal_overpay",
            correctionOperation: "correction",
            targetRevision: 1,
            targetBalanceRevision: 1,
            deltaCents: "-101",
            reason: "真实并发测试：异常超付款项已全额退回",
            responsibleUserId: ids.submitter,
            attachmentFileId: ids.file,
            applicationIdempotencyKey: randomUUID(),
            currentPassword: "not-a-real-password"
          }
        );
        const reviewInput = {
          decision: "apply" as const,
          reviewComment: "退款依据核验无误",
          currentPassword: "not-a-real-password"
        };
        const race = await Promise.allSettled([
          firstService.review(
            ids.project,
            ids.takeover,
            submitted.id,
            ids.reviewer,
            reviewInput
          ),
          secondService.review(
            ids.project,
            ids.takeover,
            submitted.id,
            ids.reviewer,
            reviewInput
          )
        ]);
        const results = [];
        for (const [index, result] of race.entries()) {
          if (result.status === "fulfilled") {
            results.push(result.value);
            continue;
          }
          expect(String(result.reason?.message ?? result.reason)).toContain(
            "并发冲突"
          );
          results.push(
            await (index === 0 ? firstService : secondService).review(
              ids.project,
              ids.takeover,
              submitted.id,
              ids.reviewer,
              reviewInput
            )
          );
        }

        expect(results).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              status: "applied",
              repeated: false
            }),
            expect.objectContaining({
              status: "applied",
              repeated: true
            })
          ])
        );
        const [correction, account, takeover, ledgerCount, applyAuditCount] =
          await Promise.all([
            first.contractTakeoverCorrection.findUniqueOrThrow({
              where: { id: submitted.id }
            }),
            first.contractTakeoverBalanceAccount.findUniqueOrThrow({
              where: { id: ids.account }
            }),
            first.contractTakeover.findUniqueOrThrow({
              where: { id: ids.takeover }
            }),
            first.contractTakeoverBalanceEntry.count({
              where: {
                accountId: ids.account,
                correctionId: submitted.id,
                entryKind: "correction"
              }
            }),
            first.auditLog.count({
              where: {
                action: "contract_takeover.correction.apply",
                businessId: ids.takeover
              }
            })
          ]);
        expect(correction.status).toBe("applied");
        expect(correction.appliedByUserId).toBe(ids.reviewer);
        expect(account.balanceCents).toBe(0n);
        expect(account.revision).toBe(2);
        expect(takeover.historicalPaidCents).toBe(0n);
        expect(ledgerCount).toBe(1);
        expect(applyAuditCount).toBe(1);

        await expect(
          first.contractTakeoverCorrection.create({
            data: {
              projectId: ids.project,
              takeoverId: ids.takeover,
              schemaVersion: 2,
              correctionType: "amount",
              correctionScope: "abnormal_overpay",
              correctionOperation: "correction",
              status: "submitted",
              targetRevision: 1,
              targetBalanceRevision: 2,
              beforeSnapshot: { balanceCents: "0" },
              deltaSnapshot: { amountCents: "1" },
              afterSnapshot: { balanceCents: "1" },
              reason: "专用文件不可复用约束测试",
              responsibleUserId: ids.submitter,
              attachmentFileId: ids.file,
              createdByUserId: ids.submitter,
              submittedByUserId: ids.submitter,
              submittedAt: new Date(),
              applicationIdempotencyKey: randomUUID()
            }
          })
        ).rejects.toThrow();
        expect(
          await first.contractTakeoverCorrection.count({
            where: { attachmentFileId: ids.file }
          })
        ).toBe(1);
      } finally {
        await Promise.all([
          first.$disconnect(),
          second.$disconnect()
        ]);
      }
    },
    30_000
  );
});

type CorrectionIds = {
  submitter: string;
  reviewer: string;
  project: string;
  contract: string;
  version: string;
  terms: string;
  takeover: string;
  account: string;
  file: string;
};

async function seedCorrectionFacts(
  client: PrismaClient,
  ids: CorrectionIds,
  suffix: string
) {
  await client.user.createMany({
    data: [
      { id: ids.submitter, name: "历史更正提交人" },
      { id: ids.reviewer, name: "历史更正财务主管" }
    ]
  });
  await client.project.create({
    data: {
      id: ids.project,
      code: `CORR-${suffix}`,
      name: "历史更正并发测试项目"
    }
  });
  await client.projectAffiliateAssignment.create({
    data: {
      id: `correction-construction-enterprise-${suffix}`,
      projectId: ids.project,
      businessPartyId: `correction-party-${suffix}`,
      businessPartyVersionId: `correction-party-version-${suffix}`,
      affiliateNameSnapshot: "历史更正测试施工企业",
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      changeReason: "数据库测试夹具",
      assignedByUserId: ids.submitter
    }
  });
  await client.projectMember.createMany({
    data: [
      {
        projectId: ids.project,
        userId: ids.submitter,
        positionKey: "finance_staff"
      },
      {
        projectId: ids.project,
        userId: ids.reviewer,
        positionKey: "finance_director"
      }
    ]
  });
  await client.contract.create({
    data: {
      id: ids.contract,
      projectId: ids.project,
      source: "historical_takeover",
      code: `CORR-CONTRACT-${suffix}`,
      name: "历史更正并发测试合同",
      counterparty: "测试供应商",
      contractTypeKey: "generic_contract"
    }
  });
  await client.contractVersion.create({
    data: {
      id: ids.version,
      contractId: ids.contract,
      versionNo: 1,
      changeType: "historical_takeover",
      status: "effective",
      amountCents: 1_000n,
      effectiveAt: new Date(),
      draftData: {},
      templateSnapshot: {},
      clauseSnapshot: {}
    }
  });
  await client.paymentTermsVersion.create({
    data: {
      id: ids.terms,
      contractId: ids.contract,
      contractVersionId: ids.version,
      versionNo: 1,
      status: "effective",
      originalText: "历史更正并发测试条款"
    }
  });
  await client.contractTakeover.create({
    data: {
      id: ids.takeover,
      projectId: ids.project,
      contractId: ids.contract,
      contractVersionId: ids.version,
      paymentTermsVersionId: ids.terms,
      takeoverLevel: "A",
      takeoverStatus: "confirmed",
      lifecycleStatus: "in_progress",
      signedAt: new Date("2026-01-01T00:00:00.000Z"),
      historicalPaidCents: 101n,
      historicalBalanceConfirmedAt: new Date(),
      historicalBalanceConfirmedByUserId: ids.reviewer,
      confirmedAt: new Date(),
      confirmedByUserId: ids.reviewer,
      activationIdempotencyKey: `correction-activation-${suffix}`,
      activatedAt: new Date(),
      activatedByUserId: ids.reviewer,
      createdByUserId: ids.submitter
    }
  });
  await client.contractTakeoverContractFacts.create({
    data: {
      takeoverId: ids.takeover,
      revision: 1,
      financeBasisRevision: 1,
      signedAt: new Date("2026-01-01T00:00:00.000Z"),
      historicalSettledCents: 0n,
      zeroSettlementDeclared: true,
      performanceStatus: "performing",
      paymentTermsSnapshot: {},
      contractFactsSnapshot: {},
      confirmedRevision: 1,
      confirmedByUserId: ids.reviewer,
      confirmedAt: new Date(),
      updatedByUserId: ids.submitter
    }
  });
  await client.contractTakeoverFinanceFacts.create({
    data: {
      takeoverId: ids.takeover,
      revision: 1,
      basedOnContractRevision: 1,
      basedOnFinanceBasisRevision: 1,
      zeroPaymentDeclared: false,
      excessTreatment: "abnormal_overpay",
      excessReason: "并发测试异常超付",
      confirmedRevision: 1,
      confirmedContractRevision: 1,
      confirmedFinanceBasisRevision: 1,
      confirmedByUserId: ids.reviewer,
      confirmedAt: new Date(),
      updatedByUserId: ids.submitter
    }
  });
  await client.fileObject.create({
    data: {
      id: ids.file,
      bucket: "local-test",
      objectKey: `correction/${suffix}`,
      originalName: "异常超付退款依据.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      uploadedByUserId: ids.submitter
    }
  });
  await client.contractTakeoverBalanceAccount.create({
    data: {
      id: ids.account,
      takeoverId: ids.takeover,
      balanceType: "abnormal_overpay",
      openingCents: 101n,
      balanceCents: 101n
    }
  });
  await client.contractTakeoverBalanceEntry.create({
    data: {
      accountId: ids.account,
      entryKind: "opening",
      amountCents: 101n,
      idempotencyKey: `correction-opening-${suffix}`,
      createdByUserId: ids.reviewer
    }
  });
}
