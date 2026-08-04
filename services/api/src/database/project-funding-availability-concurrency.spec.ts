import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
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
      const clients = [0, 1, 2, 3].map(
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
          clients.slice(0, 2).map((client, index) =>
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
        const rollbackBusinessId = businessId("rollback");
        const rollbackExecutionId = executionId("rollback");
        const rollbackVoucherFileId = `pf-exp-voucher-${marker}`;
        const rollbackPaidAt = new Date();
        await clients[0]!.projectExpenseRequest.create({
          data: {
            id: rollbackBusinessId,
            projectId: rollbackProjectId,
            code: `PF-EXP-${marker}`,
            expenseType: "comprehensive_expense",
            expenseSubtype: "travel",
            paymentSubject: "our_company",
            reason: "资金回滚门禁夹具",
            requestedAmountCents: 600n,
            approvedAmountCents: 600n,
            paymentMethod: "bank_transfer",
            handlerUserId: actorId,
            applicantUserId: actorId,
            status: "approved_pending_payment"
          }
        });
        await clients[0]!.fileObject.create({
          data: {
            id: rollbackVoucherFileId,
            bucket: "local-test",
            objectKey: `project-funding/${marker}/rollback-voucher.pdf`,
            originalName: "rollback-voucher.pdf",
            mimeType: "application/pdf",
            sizeBytes: 128,
            uploadedByUserId: actorId,
            contentSha256: "c".repeat(64),
            storageStatus: "active"
          }
        });
        await expect(
          clients[0]!.$transaction(async (tx) => {
            await tx.projectExpenseExecution.create({
              data: {
                id: rollbackExecutionId,
                idempotencyKey: randomUUID(),
                projectExpenseRequestId: rollbackBusinessId,
                projectId: rollbackProjectId,
                amountCents: 600n,
                paidAt: rollbackPaidAt,
                executedByUserId: actorId,
                voucherFileId: rollbackVoucherFileId
              }
            });
            await service.allocateExecution(tx, {
              projectId: rollbackProjectId,
              executionType: "project_expense_execution",
              executionId: rollbackExecutionId,
              businessType: "project_expense_request",
              businessId: rollbackBusinessId,
              amountCents: 600n,
              occurredAt: rollbackPaidAt,
              actorUserId: actorId
            });
            await tx.projectExpenseRequest.update({
              where: { id: rollbackBusinessId },
              data: { paidAmountCents: 600n, status: "paid" }
            });
            await tx.auditLog.create({
              data: {
                actorUserId: actorId,
                action: "project_expense.execution.record",
                businessType: "project_expense_request",
                businessId: rollbackBusinessId,
                metadata: {
                  executionId: rollbackExecutionId,
                  amountCents: "600",
                  voucherFileId: rollbackVoucherFileId
                }
              }
            });
            throw new Error("voucher binding failed");
          })
        ).rejects.toThrow("voucher binding failed");
        expect(
          await clients[0]!.projectFundingAllocation.count({
            where: { executionId: executionId("rollback") }
          })
        ).toBe(0);
        expect(
          await clients[0]!.projectExpenseExecution.count({
            where: { id: rollbackExecutionId }
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
        const inactiveQuotaId = `pf-live-quota-${marker}`;
        const inactiveQuotaAttachmentFileId =
          `pf-live-quota-file-${marker}`;
        await clients[0]!.project.create({
          data: {
            id: inactiveQuotaProjectId,
            code: `PF-QUOTA-${marker}`,
            name: "失效额度拒绝夹具"
          }
        });
        await clients[0]!.fileObject.create({
          data: {
            id: inactiveQuotaAttachmentFileId,
            bucket: "local-test",
            objectKey: `project-funding/${marker}/inactive-quota.pdf`,
            originalName: "inactive-quota.pdf",
            mimeType: "application/pdf",
            sizeBytes: 128,
            uploadedByUserId: actorId,
            contentSha256: "a".repeat(64),
            storageStatus: "active"
          }
        });
        await clients[0]!.projectFinancingQuota.create({
          data: {
            id: inactiveQuotaId,
            projectId: inactiveQuotaProjectId,
            amountCents: 1_000n,
            reason: "实库失效额度门禁",
            validUntil: new Date("2020-01-01T00:00:00.000Z"),
            attachmentFileId: inactiveQuotaAttachmentFileId,
            attachmentFileSha256Snapshot: "a".repeat(64),
            requestedByUserId: actorId,
            requestedByRoleKey: "finance_staff",
            requestIdempotencyKey: randomUUID(),
            requestFingerprint: "b".repeat(64),
            approvedByUserId: actorId,
            approvedAt: new Date("2019-01-01T00:00:00.000Z"),
            status: "approved"
          }
        });
        await clients[0]!.approvalInstance.create({
          data: {
            flowType: "project_financing_quota.approve",
            businessType: "project_financing_quota",
            businessId: inactiveQuotaId,
            status: "approved",
            currentNodeIndex: 2,
            applicantUserId: actorId,
            frozenNodes: [
              {
                name: "财务主管",
                mode: "any",
                roleKeys: ["finance_director"],
                approvedRoleKeys: ["finance_director"]
              },
              {
                name: "董事长/总经理",
                mode: "any",
                roleKeys: ["chairman", "general_manager"],
                approvedRoleKeys: ["chairman"]
              }
            ]
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
        const terminationAttachmentFileId =
          `pf-live-termination-quota-file-${marker}`;
        const preservedAttachmentFileId =
          `pf-live-preserved-quota-file-${marker}`;
        await clients[0]!.project.create({
          data: {
            id: terminationProjectId,
            code: `PF-TERMINATE-${marker}`,
            name: "垫资额度终止并发夹具"
          }
        });
        await clients[0]!.projectMember.create({
          data: {
            projectId: terminationProjectId,
            userId: actorId,
            positionKey: "finance_director"
          }
        });
        await clients[0]!.fileObject.createMany({
          data: [
            {
              id: signatureFileId,
              bucket: "local-test",
              objectKey: `project-funding/${marker}/signature.png`,
              originalName: "signature.png",
              mimeType: "image/png",
              sizeBytes: 128,
              uploadedByUserId: actorId,
              contentSha256: "a".repeat(64),
              storageStatus: "active"
            },
            {
              id: terminationAttachmentFileId,
              bucket: "local-test",
              objectKey: `project-funding/${marker}/termination-quota.pdf`,
              originalName: "termination-quota.pdf",
              mimeType: "application/pdf",
              sizeBytes: 128,
              uploadedByUserId: actorId,
              contentSha256: "b".repeat(64),
              storageStatus: "active"
            },
            {
              id: preservedAttachmentFileId,
              bucket: "local-test",
              objectKey: `project-funding/${marker}/preserved-quota.pdf`,
              originalName: "preserved-quota.pdf",
              mimeType: "application/pdf",
              sizeBytes: 128,
              uploadedByUserId: actorId,
              contentSha256: "c".repeat(64),
              storageStatus: "active"
            }
          ]
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
            attachmentFileId: terminationAttachmentFileId,
            attachmentFileSha256Snapshot: "b".repeat(64),
            requestedByUserId: actorId,
            requestedByRoleKey: "finance_staff",
            requestIdempotencyKey: randomUUID(),
            requestFingerprint: "b".repeat(64),
            approvedByUserId: actorId,
            approvedAt: new Date(),
            status: "approved"
          }
        });
        await clients[0]!.approvalInstance.create({
          data: {
            flowType: "project_financing_quota.approve",
            businessType: "project_financing_quota",
            businessId: terminationQuotaId,
            status: "approved",
            currentNodeIndex: 2,
            applicantUserId: actorId,
            frozenNodes: [
              {
                name: "财务主管",
                mode: "any",
                roleKeys: ["finance_director"],
                approvedRoleKeys: ["finance_director"]
              },
              {
                name: "董事长/总经理",
                mode: "any",
                roleKeys: ["chairman", "general_manager"],
                approvedRoleKeys: ["chairman"]
              }
            ]
          }
        });
        const projectService = new ProjectService(
          clients[0]! as never,
          undefined,
          { confirmPassword: jest.fn().mockResolvedValue(undefined) } as never,
          service
        );
        const terminationExecutionId = executionId("terminated-quota-race");
        const terminationCapability =
          await projectService.getProjectFinancingQuotaTerminationCapability(
            terminationProjectId,
            terminationQuotaId,
            actorId
          );
        const terminationActionId = randomUUID();
        const [terminationResult, concurrentQuotaPayment] =
          await runBehindProjectRowLock<unknown>({
            blockerClient: clients[2]!,
            observerClient: clients[3]!,
            projectId: terminationProjectId,
            start: () => [
              projectService.terminateProjectFinancingQuota(
                terminationProjectId,
                terminationQuotaId,
                actorId,
                {
                  actionId: terminationActionId,
                  expectedLifecycleToken: terminationCapability.lifecycleToken,
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
            ]
          });
        expect(
          [terminationResult, concurrentQuotaPayment].filter(
            (result) => result.status === "fulfilled"
          )
        ).toHaveLength(1);
        expect(
          [terminationResult, concurrentQuotaPayment].filter(
            (result) => result.status === "rejected"
          )
        ).toHaveLength(1);
        if (terminationResult.status === "rejected") {
          const refreshedCapability =
            await projectService.getProjectFinancingQuotaTerminationCapability(
              terminationProjectId,
              terminationQuotaId,
              actorId
            );
          await projectService.terminateProjectFinancingQuota(
            terminationProjectId,
            terminationQuotaId,
            actorId,
            {
              actionId: randomUUID(),
              expectedLifecycleToken: refreshedCapability.lifecycleToken,
              reason: "实库并发终止门禁",
              confirmationPassword: "local-test-password"
            }
          );
        }
        expect(
          await clients[0]!.projectFinancingQuota.findUnique({
            where: { id: terminationQuotaId },
            select: {
              status: true,
              terminatedAt: true,
              terminatedByUserId: true,
              terminationSignatureVersionId: true,
              terminationActionId: true,
              terminationRequestFingerprint: true
            }
          })
        ).toMatchObject({
          status: "terminated",
          terminatedAt: expect.any(Date),
          terminatedByUserId: actorId,
          terminationSignatureVersionId: `pf-live-signature-version-${marker}`,
          terminationActionId: expect.any(String),
          terminationRequestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u)
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
        await clients[0]!.projectMember.create({
          data: {
            projectId: preservedProjectId,
            userId: actorId,
            positionKey: "finance_director"
          }
        });
        await clients[0]!.projectFinancingQuota.create({
          data: {
            id: preservedQuotaId,
            projectId: preservedProjectId,
            amountCents: 2_000n,
            reason: "实库终止保留流水门禁",
            validUntil: null,
            attachmentFileId: preservedAttachmentFileId,
            attachmentFileSha256Snapshot: "c".repeat(64),
            requestedByUserId: actorId,
            requestedByRoleKey: "finance_staff",
            requestIdempotencyKey: randomUUID(),
            requestFingerprint: "b".repeat(64),
            approvedByUserId: actorId,
            approvedAt: new Date(),
            status: "approved"
          }
        });
        await clients[0]!.approvalInstance.create({
          data: {
            flowType: "project_financing_quota.approve",
            businessType: "project_financing_quota",
            businessId: preservedQuotaId,
            status: "approved",
            currentNodeIndex: 2,
            applicantUserId: actorId,
            frozenNodes: [
              {
                name: "财务主管",
                mode: "any",
                roleKeys: ["finance_director"],
                approvedRoleKeys: ["finance_director"]
              },
              {
                name: "董事长/总经理",
                mode: "any",
                roleKeys: ["chairman", "general_manager"],
                approvedRoleKeys: ["chairman"]
              }
            ]
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
        const preservedCapability =
          await projectService.getProjectFinancingQuotaTerminationCapability(
            preservedProjectId,
            preservedQuotaId,
            actorId
          );
        await projectService.terminateProjectFinancingQuota(
          preservedProjectId,
          preservedQuotaId,
          actorId,
          {
            actionId: randomUUID(),
            expectedLifecycleToken: preservedCapability.lifecycleToken,
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

async function runBehindProjectRowLock<T>({
  blockerClient,
  observerClient,
  projectId,
  start
}: {
  blockerClient: PrismaClient;
  observerClient: PrismaClient;
  projectId: string;
  start: () => Array<Promise<T>>;
}): Promise<Array<PromiseSettledResult<T>>> {
  let operations: Array<Promise<T>> = [];
  await blockerClient.$transaction(
    async (tx) => {
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>(
        Prisma.sql`SELECT pg_backend_pid()::int AS pid`
      );
      if (!backend) throw new Error("无法识别项目资金竞态 blocker backend");
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "Project"
          WHERE "id" = ${projectId}
          FOR UPDATE
        `
      );
      if (locked.length !== 1) throw new Error("项目资金竞态未锁定项目行");
      operations = start();
      for (const operation of operations) void operation.catch(() => undefined);
      if (operations.length !== 2) throw new Error("项目资金竞态必须启动两个 backend");
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        const blocked = await observerClient.$queryRaw<Array<{ pid: number }>>(
          Prisma.sql`
            SELECT activity.pid::int AS pid
            FROM pg_stat_activity AS activity
            WHERE activity.datname = current_database()
              AND activity.pid <> pg_backend_pid()
              AND activity.wait_event_type = 'Lock'
              AND ${backend.pid} = ANY(pg_blocking_pids(activity.pid))
              AND position('FROM "Project"' IN activity.query) > 0
              AND position('FOR UPDATE' IN activity.query) > 0
            ORDER BY activity.pid
          `
        );
        if (new Set(blocked.map((row) => row.pid)).size >= operations.length) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("等待项目资金竞态 backend 锁等待超时");
    },
    { maxWait: 5_000, timeout: 15_000 }
  );
  return Promise.allSettled(operations);
}
