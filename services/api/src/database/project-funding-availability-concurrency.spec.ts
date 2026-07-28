import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { ProjectService } from "../project/project.service";

const TEST_DATABASE = "jiangkong_project_funding_integration_test";

export function projectFundingDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("项目资金并发测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("项目资金并发测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("project funding PostgreSQL evidence", () => {
  const integrationTest =
    process.env.RUN_PROJECT_FUNDING_DATABASE === "1" ? it : it.skip;

  integrationTest(
    "serializes concurrent payments and preserves rollback, retry, source and project boundaries",
    async () => {
      const databaseUrl = projectFundingDatabaseUrl(
        process.env.PROJECT_FUNDING_DATABASE_URL
      );
      const clients = [0, 1].map(
        () =>
          new PrismaClient({
            datasources: { db: { url: databaseUrl } }
          })
      );
      const service = new ProjectFundingAvailabilityService();
      const marker = randomUUID();
      const actorId = `pf-live-user-${marker}`;
      const projectId = (name: string) => `pf-live-${name}-${marker}`;
      const executionId = (name: string) => `pf-live-exec-${name}-${marker}`;
      const businessId = (name: string) => `pf-live-business-${name}-${marker}`;

      try {
        await clients[0]!.user.create({
          data: { id: actorId, name: "项目资金实库门禁用户" }
        });

        const concurrentProjectId = projectId("concurrent");
        await seedProjectCash(
          clients[0]!,
          concurrentProjectId,
          actorId,
          1_000n,
          "general_contractor_payment"
        );
        const concurrentResults = await Promise.allSettled(
          clients.map((client, index) =>
            client.$transaction((tx) =>
              service.allocateExecution(tx, {
                projectId: concurrentProjectId,
                executionType: "payment_execution",
                executionId: executionId(`concurrent-${index}`),
                businessType: "payment_request",
                businessId: businessId(`concurrent-${index}`),
                amountCents: 800n,
                occurredAt: new Date(),
                actorUserId: actorId
              })
            )
          )
        );
        expect(
          concurrentResults.filter((result) => result.status === "fulfilled")
        ).toHaveLength(1);
        expect(
          concurrentResults.filter((result) => result.status === "rejected")
        ).toHaveLength(1);
        expect(
          await clients[0]!.projectFundingAllocation.aggregate({
            where: { projectId: concurrentProjectId, direction: "debit" },
            _sum: { amountCents: true },
            _count: true
          })
        ).toMatchObject({
          _count: 1,
          _sum: { amountCents: 800n }
        });

        const rollbackProjectId = projectId("rollback");
        await seedProjectCash(
          clients[0]!,
          rollbackProjectId,
          actorId,
          1_000n,
          "general_contractor_payment"
        );
        await expect(
          clients[0]!.$transaction(async (tx) => {
            await service.allocateExecution(tx, {
              projectId: rollbackProjectId,
              executionType: "project_expense_execution",
              executionId: executionId("rollback"),
              businessType: "project_expense_request",
              businessId: businessId("rollback"),
              amountCents: 600n,
              occurredAt: new Date(),
              actorUserId: actorId
            });
            throw new Error("voucher binding failed");
          })
        ).rejects.toThrow("voucher binding failed");
        expect(
          await clients[0]!.projectFundingAllocation.count({
            where: { executionId: executionId("rollback") }
          })
        ).toBe(0);

        const retryProjectId = projectId("retry");
        await seedProjectCash(
          clients[0]!,
          retryProjectId,
          actorId,
          1_000n,
          "general_contractor_payment"
        );
        const retryInput = {
          projectId: retryProjectId,
          executionType: "expense_claim_payment_execution" as const,
          executionId: executionId("retry"),
          businessType: "expense_claim",
          businessId: businessId("retry"),
          amountCents: 400n,
          occurredAt: new Date(),
          actorUserId: actorId
        };
        await expect(
          clients[0]!.$transaction((tx) =>
            service.allocateExecution(tx, retryInput)
          )
        ).resolves.toMatchObject({ kind: "allocated" });
        await expect(
          clients[0]!.$transaction((tx) =>
            service.allocateExecution(tx, retryInput)
          )
        ).resolves.toMatchObject({ kind: "replayed" });
        expect(
          await clients[0]!.projectFundingAllocation.count({
            where: { executionId: retryInput.executionId, direction: "debit" }
          })
        ).toBe(1);

        const crossProjectId = projectId("cross");
        await clients[0]!.project.create({
          data: {
            id: crossProjectId,
            code: `PF-CROSS-${marker}`,
            name: "跨项目拒绝夹具"
          }
        });
        await expect(
          clients[0]!.$transaction((tx) =>
            service.allocateExecution(tx, {
              ...retryInput,
              projectId: crossProjectId,
              businessId: businessId("cross")
            })
          )
        ).rejects.toThrow("同一实付编号已绑定不同的项目资金事实");

        const invalidSourceProjectId = projectId("wrong-source");
        await seedProjectCash(
          clients[0]!,
          invalidSourceProjectId,
          actorId,
          1_000n,
          "owner_direct_payment"
        );
        await expect(
          clients[0]!.$transaction((tx) =>
            service.allocateExecution(tx, {
              ...retryInput,
              projectId: invalidSourceProjectId,
              executionId: executionId("wrong-source"),
              businessId: businessId("wrong-source"),
              amountCents: 1n
            })
          )
        ).rejects.toThrow("项目可用资金不足，当前最多可实际支付 0 分");

        const inactiveQuotaProjectId = projectId("inactive-quota");
        await clients[0]!.project.create({
          data: {
            id: inactiveQuotaProjectId,
            code: `PF-QUOTA-${marker}`,
            name: "失效额度拒绝夹具"
          }
        });
        await clients[0]!.projectFinancingQuota.create({
          data: {
            id: `pf-live-quota-${marker}`,
            projectId: inactiveQuotaProjectId,
            amountCents: 1_000n,
            reason: "实库失效额度门禁",
            validUntil: new Date("2020-01-01T00:00:00.000Z"),
            attachmentFileId: `pf-live-quota-file-${marker}`,
            requestedByUserId: actorId,
            approvedByUserId: actorId,
            approvedAt: new Date("2019-01-01T00:00:00.000Z"),
            status: "approved"
          }
        });
        await expect(
          clients[0]!.$transaction((tx) =>
            service.allocateExecution(tx, {
              ...retryInput,
              projectId: inactiveQuotaProjectId,
              executionId: executionId("inactive-quota"),
              businessId: businessId("inactive-quota"),
              amountCents: 1n
            })
          )
        ).rejects.toThrow("项目可用资金不足，当前最多可实际支付 0 分");

        const terminationProjectId = projectId("terminated-quota");
        const terminationQuotaId = `pf-live-terminated-quota-${marker}`;
        const signatureFileId = `pf-live-signature-file-${marker}`;
        await clients[0]!.project.create({
          data: {
            id: terminationProjectId,
            code: `PF-TERMINATE-${marker}`,
            name: "垫资额度终止并发夹具"
          }
        });
        await clients[0]!.fileObject.create({
          data: {
            id: signatureFileId,
            bucket: "local-test",
            objectKey: `project-funding/${marker}/signature.png`,
            originalName: "signature.png",
            mimeType: "image/png",
            sizeBytes: 128,
            uploadedByUserId: actorId,
            contentSha256: "a".repeat(64),
            storageStatus: "active"
          }
        });
        await clients[0]!.handwrittenSignatureVersion.create({
          data: {
            id: `pf-live-signature-version-${marker}`,
            userId: actorId,
            fileId: signatureFileId,
            contentSha256: "a".repeat(64),
            source: "canvas"
          }
        });
        await clients[0]!.projectFinancingQuota.create({
          data: {
            id: terminationQuotaId,
            projectId: terminationProjectId,
            amountCents: 2_000n,
            reason: "实库终止并发门禁",
            validUntil: null,
            attachmentFileId: signatureFileId,
            requestedByUserId: actorId,
            approvedByUserId: actorId,
            approvedAt: new Date(),
            status: "approved"
          }
        });
        const projectService = new ProjectService(
          clients[0]! as never,
          undefined,
          { confirmPassword: jest.fn().mockResolvedValue(undefined) } as never,
          service
        );
        const terminationExecutionId = executionId("terminated-quota-race");
        const [terminationResult, concurrentQuotaPayment] = await Promise.allSettled([
          projectService.terminateProjectFinancingQuota(
            terminationProjectId,
            terminationQuotaId,
            actorId,
            {
              reason: "实库并发终止门禁",
              confirmationPassword: "local-test-password"
            }
          ),
          clients[1]!.$transaction((tx) =>
            service.allocateExecution(tx, {
              ...retryInput,
              projectId: terminationProjectId,
              executionId: terminationExecutionId,
              businessId: businessId("terminated-quota-race"),
              amountCents: 500n
            })
          )
        ]);
        expect(terminationResult.status).toBe("fulfilled");
        expect(["fulfilled", "rejected"]).toContain(concurrentQuotaPayment.status);
        expect(
          await clients[0]!.projectFinancingQuota.findUnique({
            where: { id: terminationQuotaId },
            select: {
              status: true,
              terminatedAt: true,
              terminatedByUserId: true,
              terminationSignatureVersionId: true
            }
          })
        ).toMatchObject({
          status: "terminated",
          terminatedAt: expect.any(Date),
          terminatedByUserId: actorId,
          terminationSignatureVersionId: `pf-live-signature-version-${marker}`
        });
        const terminationRaceAllocations =
          await clients[0]!.projectFundingAllocation.findMany({
            where: { executionId: terminationExecutionId }
          });
        expect(terminationRaceAllocations.length === 0 || terminationRaceAllocations.length === 1)
          .toBe(true);
        if (terminationRaceAllocations.length === 1) {
          expect(terminationRaceAllocations[0]).toMatchObject({
            sourceId: terminationQuotaId,
            direction: "debit",
            amountCents: 500n
          });
        }
        await expect(
          clients[0]!.$transaction((tx) =>
            service.allocateExecution(tx, {
              ...retryInput,
              projectId: terminationProjectId,
              executionId: executionId("terminated-quota-after"),
              businessId: businessId("terminated-quota-after"),
              amountCents: 1n
            })
          )
        ).rejects.toThrow("项目可用资金不足，当前最多可实际支付 0 分");

        const preservedProjectId = projectId("terminated-quota-preserved");
        const preservedQuotaId = `pf-live-preserved-quota-${marker}`;
        const preservedExecutionId = executionId("terminated-quota-preserved");
        await clients[0]!.project.create({
          data: {
            id: preservedProjectId,
            code: `PF-PRESERVE-${marker}`,
            name: "垫资额度终止保留流水夹具"
          }
        });
        await clients[0]!.projectFinancingQuota.create({
          data: {
            id: preservedQuotaId,
            projectId: preservedProjectId,
            amountCents: 2_000n,
            reason: "实库终止保留流水门禁",
            validUntil: null,
            attachmentFileId: signatureFileId,
            requestedByUserId: actorId,
            approvedByUserId: actorId,
            approvedAt: new Date(),
            status: "approved"
          }
        });
        await clients[0]!.$transaction((tx) =>
          service.allocateExecution(tx, {
            ...retryInput,
            projectId: preservedProjectId,
            executionId: preservedExecutionId,
            businessId: businessId("terminated-quota-preserved"),
            amountCents: 500n
          })
        );
        await projectService.terminateProjectFinancingQuota(
          preservedProjectId,
          preservedQuotaId,
          actorId,
          {
            reason: "实库终止后保留既有资金流水",
            confirmationPassword: "local-test-password"
          }
        );
        expect(
          await clients[0]!.projectFundingAllocation.aggregate({
            where: { projectId: preservedProjectId },
            _count: true,
            _sum: { amountCents: true }
          })
        ).toMatchObject({
          _count: 1,
          _sum: { amountCents: 500n }
        });
        await expect(
          clients[0]!.$transaction((tx) =>
            service.allocateExecution(tx, {
              ...retryInput,
              projectId: preservedProjectId,
              executionId: executionId("terminated-quota-preserved-after"),
              businessId: businessId("terminated-quota-preserved-after"),
              amountCents: 1n
            })
          )
        ).rejects.toThrow("项目可用资金不足，当前最多可实际支付 0 分");

        const reversalProjectId = projectId("reversal");
        await seedProjectCash(
          clients[0]!,
          reversalProjectId,
          actorId,
          1_000n,
          "general_contractor_payment"
        );
        const reversedExecutionId = executionId("reversal");
        await clients[0]!.$transaction((tx) =>
          service.allocateExecution(tx, {
            ...retryInput,
            projectId: reversalProjectId,
            executionId: reversedExecutionId,
            businessId: businessId("reversal"),
            amountCents: 500n
          })
        );
        await clients[0]!.$transaction((tx) =>
          service.reverseExecution(tx, {
            projectId: reversalProjectId,
            executionType: "expense_claim_payment_execution",
            executionId: reversedExecutionId,
            amountCents: 200n,
            occurredAt: new Date(),
            reversalKey: `pf-live-refund-${marker}`,
            reason: "实库退款反向门禁",
            actorUserId: actorId
          })
        );
        await expect(
          clients[0]!.$transaction((tx) =>
            service.allocateExecution(tx, {
              ...retryInput,
              projectId: reversalProjectId,
              executionId: executionId("reversal-next"),
              businessId: businessId("reversal-next"),
              amountCents: 700n
            })
          )
        ).resolves.toMatchObject({
          projectCashAmountCents: 700n
        });
      } finally {
        // 保留带随机前缀的隔离事实作为门禁证据，不执行物理删除。
        await Promise.allSettled(clients.map((client) => client.$disconnect()));
      }
    },
    60_000
  );
});

async function seedProjectCash(
  client: PrismaClient,
  projectId: string,
  actorUserId: string,
  amountCents: bigint,
  sourceType: "general_contractor_payment" | "owner_direct_payment" | "other"
) {
  const marker = projectId.slice("pf-live-".length);
  await client.project.create({
    data: {
      id: projectId,
      code: `PF-${marker}`,
      name: `项目资金实库夹具 ${marker}`
    }
  });
  await client.projectReceipt.create({
    data: {
      id: `pf-live-receipt-${marker}`,
      projectId,
      receivedAt: new Date(),
      amountCents,
      payerName: "项目资金实库付款方",
      sourceType,
      voucherFileId: `pf-live-receipt-file-${marker}`,
      recordedByUserId: actorUserId
    }
  });
}
