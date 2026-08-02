import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { ProjectService } from "../project/project.service";

const DATABASE_NAME = "jiangkong_project_financing_quota_concurrency";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const PENDING_NODES = [
  {
    name: "财务主管",
    mode: "any",
    roleKeys: ["finance_director"]
  },
  {
    name: "董事长/总经理",
    mode: "any",
    roleKeys: ["chairman", "general_manager"]
  }
] as const;
const APPROVED_NODES = [
  { ...PENDING_NODES[0], approvedRoleKeys: ["finance_director"] },
  { ...PENDING_NODES[1], approvedRoleKeys: ["chairman"] }
] as const;

interface TerminationImmutableMutationContext {
  alternateActorId: string;
  alternateSignatureFileId: string;
  alternateSignatureVersionId: string;
}

const TERMINATION_IMMUTABLE_MUTATIONS = [
  {
    field: "status",
    execute: (
      client: PrismaClient,
      quotaId: string,
      context: TerminationImmutableMutationContext
    ) => {
      void context;
      return client.projectFinancingQuota.update({
        where: { id: quotaId },
        data: { status: "approved" }
      });
    }
  },
  {
    field: "terminatedAt",
    execute: (
      client: PrismaClient,
      quotaId: string,
      context: TerminationImmutableMutationContext
    ) => {
      void context;
      return client.projectFinancingQuota.update({
        where: { id: quotaId },
        data: { terminatedAt: new Date(Date.now() + 60_000) }
      });
    }
  },
  {
    field: "terminatedByUserId",
    execute: (
      client: PrismaClient,
      quotaId: string,
      context: TerminationImmutableMutationContext
    ) => client.projectFinancingQuota.update({
      where: { id: quotaId },
      data: { terminatedByUserId: context.alternateActorId }
    })
  },
  {
    field: "terminationReason",
    execute: (
      client: PrismaClient,
      quotaId: string,
      context: TerminationImmutableMutationContext
    ) => {
      void context;
      return client.projectFinancingQuota.update({
        where: { id: quotaId },
        data: { terminationReason: "篡改终止原因" }
      });
    }
  },
  {
    field: "terminationSignatureFileId",
    execute: (
      client: PrismaClient,
      quotaId: string,
      context: TerminationImmutableMutationContext
    ) => client.projectFinancingQuota.update({
      where: { id: quotaId },
      data: { terminationSignatureFileId: context.alternateSignatureFileId }
    })
  },
  {
    field: "terminationSignatureSha256",
    execute: (
      client: PrismaClient,
      quotaId: string,
      context: TerminationImmutableMutationContext
    ) => {
      void context;
      return client.projectFinancingQuota.update({
        where: { id: quotaId },
        data: { terminationSignatureSha256: SHA_B }
      });
    }
  },
  {
    field: "terminationSignatureVersionId",
    execute: (
      client: PrismaClient,
      quotaId: string,
      context: TerminationImmutableMutationContext
    ) => client.projectFinancingQuota.update({
      where: { id: quotaId },
      data: {
        terminationSignatureVersionId: context.alternateSignatureVersionId
      }
    })
  },
  {
    field: "terminationActionId",
    execute: (
      client: PrismaClient,
      quotaId: string,
      context: TerminationImmutableMutationContext
    ) => {
      void context;
      return client.projectFinancingQuota.update({
        where: { id: quotaId },
        data: { terminationActionId: randomUUID() }
      });
    }
  },
  {
    field: "terminationRequestFingerprint",
    execute: (
      client: PrismaClient,
      quotaId: string,
      context: TerminationImmutableMutationContext
    ) => {
      void context;
      return client.projectFinancingQuota.update({
        where: { id: quotaId },
        data: { terminationRequestFingerprint: SHA_D }
      });
    }
  }
] as const;

export function projectFinancingQuotaDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("项目垫资额度并发测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${DATABASE_NAME}`
  ) {
    throw new Error("项目垫资额度并发测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("project financing quota PostgreSQL evidence", () => {
  it("rejects missing, production, remote and wrong-name databases", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      expect(() => projectFinancingQuotaDatabaseUrl(undefined)).toThrow();
      expect(() => projectFinancingQuotaDatabaseUrl(
        "postgresql://local:secret@db.example.com:5432/jiangkong_project_financing_quota_concurrency"
      )).toThrow();
      expect(() => projectFinancingQuotaDatabaseUrl(
        "postgresql://local:secret@127.0.0.1:5432/jiangkong"
      )).toThrow();
      process.env.NODE_ENV = "production";
      expect(() => projectFinancingQuotaDatabaseUrl(
        "postgresql://local:secret@127.0.0.1:5432/jiangkong_project_financing_quota_concurrency"
      )).toThrow();
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  const integrationTest =
    process.env.RUN_PROJECT_FINANCING_QUOTA_DATABASE === "1" ? it : it.skip;

  integrationTest(
    "F1 serializes one requestIdempotencyKey into one created receipt and one replay",
    async () => {
      const clients = clientsForTest();
      const marker = randomUUID();
      try {
        const projectId = id(marker, "f1-project");
        const actorId = id(marker, "f1-actor");
        const attachmentFileId = id(marker, "f1-attachment");
        await seedProject(clients[0]!, projectId, marker, "F1 并发申请");
        await seedActor(clients[0]!, projectId, actorId, "finance_staff");
        await seedFile(clients[0]!, attachmentFileId, actorId, SHA_A);
        const requestIdempotencyKey = randomUUID();
        const input = {
          idempotencyKey: requestIdempotencyKey,
          amountCents: "2000",
          reason: "F1 同幂等键并发",
          attachmentFileId
        };
        const services = clients.map((client) => projectService(client!));

        const { operations, backendPids } =
          await startBehindProjectRowLockEvidence({
            blockerClient: clients[2]!,
            observerClient: clients[3]!,
            projectId,
            start: () => [
              services[0]!.requestProjectFinancingQuota(
                projectId,
                actorId,
                input
              ),
              services[1]!.requestProjectFinancingQuota(
                projectId,
                actorId,
                input
              )
            ]
          });
        expect(backendPids).toHaveLength(2);
        expect(new Set(backendPids).size).toBe(2);
        const settled = await withTimeout(
          Promise.allSettled(operations),
          10_000,
          "F1 同幂等键双 backend 请求未及时收口"
        );
        expect(settled.every((result) => result.status === "fulfilled"))
          .toBe(true);
        const results = settled.map((result) => {
          if (result.status !== "fulfilled") {
            throw result.reason;
          }
          return result.value;
        });
        expect(results.map((result) => result.kind).sort()).toEqual([
          "created",
          "replayed"
        ]);
        expect(new Set(results.map((result) => result.quotaId)).size).toBe(1);
        const quotaId = results[0]!.quotaId;
        expect(await clients[0]!.projectFinancingQuota.count({
          where: { requestIdempotencyKey }
        })).toBe(1);
        expect(await clients[0]!.approvalInstance.count({
          where: {
            businessType: "project_financing_quota",
            businessId: quotaId
          }
        })).toBe(1);
        expect(await clients[0]!.auditLog.count({
          where: {
            action: "project.financing_quota.request",
            businessId: quotaId
          }
        })).toBe(1);
      } finally {
        await disconnect(clients);
      }
    },
    120_000
  );

  integrationTest(
    "F1 rolls quota, lifecycle and Audit back when Audit fails after business writes",
    async () => {
      const clients = clientsForTest();
      const marker = randomUUID();
      let auditFault: AuditInsertFailure | undefined;
      try {
        const projectId = id(marker, "f1-audit-project");
        const actorId = id(marker, "f1-audit-actor");
        const attachmentFileId = id(marker, "f1-audit-attachment");
        await seedProject(clients[0]!, projectId, marker, "F1 Audit 回滚");
        await seedActor(clients[0]!, projectId, actorId, "finance_staff");
        await seedFile(clients[0]!, attachmentFileId, actorId, SHA_A);
        const requestIdempotencyKey = randomUUID();
        auditFault = await installAuditInsertFailure(clients[0]!, {
          action: "project.financing_quota.request",
          requestIdempotencyKey
        });
        const service = projectService(clients[0]!);

        const failure = await captureFailure(service.requestProjectFinancingQuota(
          projectId,
          actorId,
          {
            idempotencyKey: requestIdempotencyKey,
            amountCents: "2000",
            reason: "F1 Audit 中段失败",
            attachmentFileId
          }
        ));
        expect(databaseFailureText(failure)).toContain(
          "pfq_audit_insert_failure"
        );
        expect(await clients[0]!.projectFinancingQuota.count({
          where: { projectId }
        })).toBe(0);
        expect(await clients[0]!.approvalInstance.count({
          where: {
            businessType: "project_financing_quota",
            applicantUserId: actorId
          }
        })).toBe(0);
        expect(await clients[0]!.auditLog.count({
          where: { action: "project.financing_quota.request", actorUserId: actorId }
        })).toBe(0);
      } finally {
        if (auditFault) {
          await dropAuditInsertFailure(clients[0]!, auditFault);
        }
        await disconnect(clients);
      }
    },
    120_000
  );

  integrationTest(
    "F1 rejects quota attachment reuse in both business-binding directions with zero writes",
    async () => {
      const clients = clientsForTest();
      const marker = randomUUID();
      try {
        const projectId = id(marker, "f1-file-project");
        const actorId = id(marker, "f1-file-actor");
        const quotaFileId = id(marker, "f1-quota-file");
        const businessBoundFileId = id(marker, "f1-business-bound-file");
        await seedProject(clients[0]!, projectId, marker, "F1 文件复用");
        await seedActor(clients[0]!, projectId, actorId, "finance_staff");
        await seedFile(clients[0]!, quotaFileId, actorId, SHA_A);
        await seedFile(clients[0]!, businessBoundFileId, actorId, SHA_B);
        const service = projectService(clients[0]!);

        const created = await service.requestProjectFinancingQuota(
          projectId,
          actorId,
          {
            idempotencyKey: randomUUID(),
            amountCents: "2000",
            reason: "首次绑定额度附件",
            attachmentFileId: quotaFileId
          }
        );
        expect(created.kind).toBe("created");
        const baseline = await projectFinancingBusinessCounts(
          clients[0]!, projectId, actorId
        );
        expect(baseline).toEqual({ quotas: 1, approvals: 1, audits: 1 });

        await expect(service.requestProjectFinancingQuota(
          projectId,
          actorId,
          {
            idempotencyKey: randomUUID(),
            amountCents: "2100",
            reason: "同一文件不能创建第二条额度",
            attachmentFileId: quotaFileId
          }
        )).rejects.toThrow("项目垫资额度附件已绑定其他业务事实");
        expect(await projectFinancingBusinessCounts(
          clients[0]!, projectId, actorId
        )).toEqual(baseline);

        const reverseBindingError = await captureFailure(
          clients[0]!.archiveRecord.create({
            data: {
              id: id(marker, "f1-reverse-archive"),
              businessType: "contract",
              businessId: id(marker, "f1-reverse-business"),
              fileId: quotaFileId,
              departmentScope: "contract"
            }
          })
        );
        expect(databaseFailureText(reverseBindingError)).toContain(
          "exclusive_file_business_binding_guard"
        );
        expect(await clients[0]!.archiveRecord.count({
          where: { fileId: quotaFileId }
        })).toBe(0);
        expect(await projectFinancingBusinessCounts(
          clients[0]!, projectId, actorId
        )).toEqual(baseline);

        await clients[0]!.archiveRecord.create({
          data: {
            id: id(marker, "f1-existing-archive"),
            businessType: "contract",
            businessId: id(marker, "f1-existing-business"),
            fileId: businessBoundFileId,
            departmentScope: "contract"
          }
        });
        await expect(service.requestProjectFinancingQuota(
          projectId,
          actorId,
          {
            idempotencyKey: randomUUID(),
            amountCents: "2200",
            reason: "业务已绑定文件不能申请额度",
            attachmentFileId: businessBoundFileId
          }
        )).rejects.toThrow("项目垫资额度附件已绑定其他业务事实");
        expect(await projectFinancingBusinessCounts(
          clients[0]!, projectId, actorId
        )).toEqual(baseline);
        expect(await clients[0]!.archiveRecord.count({
          where: { fileId: businessBoundFileId }
        })).toBe(1);
      } finally {
        await disconnect(clients);
      }
    },
    120_000
  );

  integrationTest(
    "F2 replays one actionId, serializes competing finance actions and OR-signs once",
    async () => {
      const clients = clientsForTest();
      const marker = randomUUID();
      try {
        const fixture = await seedPendingQuota(clients[0]!, marker, "f2");
        const financeA = id(marker, "finance-a");
        const financeB = id(marker, "finance-b");
        const chairman = id(marker, "chairman");
        const generalManager = id(marker, "general-manager");
        for (const [actorId, role] of [
          [financeA, "finance_director"],
          [financeB, "finance_director"],
          [chairman, "chairman"],
          [generalManager, "general_manager"]
        ] as const) {
          await seedActor(clients[0]!, fixture.projectId, actorId, role);
          await seedSignature(clients[0]!, actorId, `${role}-${marker}`, SHA_A);
        }
        const financeServices = clients.map((client) => projectService(client!));
        const initialCapability =
          await financeServices[0]!.getProjectFinancingQuotaReviewCapability(
            fixture.projectId,
            fixture.quotaId,
            financeA
          );
        const replayActionId = randomUUID();
        const replayInput = {
          actionId: replayActionId,
          expectedLifecycleToken: initialCapability.lifecycleToken,
          decision: "approve" as const,
          confirmationPassword: "local-password",
          comment: "财务主管节点同动作重放"
        };

        const replayResults = await runOverlappingCommittedReplay({
          firstClient: clients[0]!,
          secondClient: clients[1]!,
          invoke: (client) =>
            projectService(client).reviewProjectFinancingQuota(
              fixture.projectId,
              fixture.quotaId,
              financeA,
              replayInput
            )
        });
        expect(replayResults.every((result) => result.status === "fulfilled"))
          .toBe(true);
        expect(replayResults.map((result) =>
          result.status === "fulfilled" ? result.value.kind : "rejected"
        ).sort()).toEqual(["applied", "replayed"]);
        expect(await clients[0]!.approvalActionLog.count({
          where: { id: replayActionId }
        })).toBe(1);
        expect(await clients[0]!.auditLog.count({
          where: {
            action: "project.financing_quota.approve",
            businessId: fixture.quotaId,
            actorUserId: financeA
          }
        })).toBe(1);

        const orCapability =
          await financeServices[0]!.getProjectFinancingQuotaReviewCapability(
            fixture.projectId,
            fixture.quotaId,
            chairman
          );
        const orResults = await runBehindProjectRowLock({
          blockerClient: clients[2]!,
          observerClient: clients[3]!,
          projectId: fixture.projectId,
          start: () => [
            financeServices[0]!.reviewProjectFinancingQuota(
              fixture.projectId,
              fixture.quotaId,
              chairman,
              {
                actionId: randomUUID(),
                expectedLifecycleToken: orCapability.lifecycleToken,
                decision: "approve",
                confirmationPassword: "local-password",
                comment: "董事长 OR 签"
              }
            ),
            financeServices[1]!.reviewProjectFinancingQuota(
              fixture.projectId,
              fixture.quotaId,
              generalManager,
              {
                actionId: randomUUID(),
                expectedLifecycleToken: orCapability.lifecycleToken,
                decision: "approve",
                confirmationPassword: "local-password",
                comment: "总经理 OR 签"
              }
            )
          ]
        });
        expectOneStableConflict(
          orResults,
          "项目垫资额度审批发生并发冲突，请刷新后重试"
        );
        const quota = await clients[0]!.projectFinancingQuota.findUniqueOrThrow({
          where: { id: fixture.quotaId }
        });
        const approval = await clients[0]!.approvalInstance.findUniqueOrThrow({
          where: { id: fixture.approvalId }
        });
        expect(quota.status).toBe("approved");
        expect([chairman, generalManager]).toContain(quota.approvedByUserId);
        expect(approval).toMatchObject({ status: "approved", currentNodeIndex: 2 });
        expect(await clients[0]!.approvalActionLog.count({
          where: { approvalInstanceId: fixture.approvalId }
        })).toBe(2);
        expect(await clients[0]!.auditLog.count({
          where: {
            action: "project.financing_quota.approve",
            businessId: fixture.quotaId
          }
        })).toBe(2);
      } finally {
        await disconnect(clients);
      }
    },
    120_000
  );

  integrationTest(
    "F2 gives one winner to competing finance actionIds",
    async () => {
      const clients = clientsForTest();
      const marker = randomUUID();
      try {
        const fixture = await seedPendingQuota(clients[0]!, marker, "f2-race");
        const financeA = id(marker, "race-finance-a");
        const financeB = id(marker, "race-finance-b");
        for (const actorId of [financeA, financeB]) {
          await seedActor(
            clients[0]!, fixture.projectId, actorId, "finance_director"
          );
          await seedSignature(clients[0]!, actorId, actorId, SHA_A);
        }
        const services = clients.map((client) => projectService(client!));
        const capability =
          await services[0]!.getProjectFinancingQuotaReviewCapability(
            fixture.projectId,
            fixture.quotaId,
            financeA
          );
        const results = await runBehindProjectRowLock({
          blockerClient: clients[2]!,
          observerClient: clients[3]!,
          projectId: fixture.projectId,
          start: () => [
            services[0]!.reviewProjectFinancingQuota(
              fixture.projectId,
              fixture.quotaId,
              financeA,
              {
                actionId: randomUUID(),
                expectedLifecycleToken: capability.lifecycleToken,
                decision: "approve",
                confirmationPassword: "local-password"
              }
            ),
            services[1]!.reviewProjectFinancingQuota(
              fixture.projectId,
              fixture.quotaId,
              financeB,
              {
                actionId: randomUUID(),
                expectedLifecycleToken: capability.lifecycleToken,
                decision: "approve",
                confirmationPassword: "local-password"
              }
            )
          ]
        });
        expectOneStableConflict(
          results,
          "项目垫资额度审批发生并发冲突，请刷新后重试"
        );
        expect(await clients[0]!.approvalActionLog.count({
          where: { approvalInstanceId: fixture.approvalId }
        })).toBe(1);
        expect(await clients[0]!.auditLog.count({
          where: {
            action: "project.financing_quota.approve",
            businessId: fixture.quotaId
          }
        })).toBe(1);
      } finally {
        await disconnect(clients);
      }
    },
    120_000
  );

  integrationTest(
    "F2 missing or drifted signatures and Audit failure leave every business fact unchanged",
    async () => {
      const clients = clientsForTest();
      const marker = randomUUID();
      try {
        for (const mode of ["missing", "sha-drift", "audit"] as const) {
          const fixture = await seedPendingQuota(
            clients[0]!, marker, `f2-${mode}`
          );
          const actorId = id(marker, `f2-${mode}-actor`);
          await seedActor(
            clients[0]!, fixture.projectId, actorId, "finance_director"
          );
          if (mode === "sha-drift") {
            await seedSignature(
              clients[0]!, actorId, `${mode}-${marker}`, SHA_B, SHA_A
            );
          } else if (mode === "audit") {
            await seedSignature(
              clients[0]!, actorId, `${mode}-${marker}`, SHA_A
            );
          }
          const service = projectService(clients[0]!);
          const before = await quotaLifecycleSnapshot(
            clients[0]!, fixture.quotaId, fixture.approvalId
          );
          const capability = await service.getProjectFinancingQuotaReviewCapability(
            fixture.projectId,
            fixture.quotaId,
            actorId
          );
          const actionId = randomUUID();
          let auditFault: AuditInsertFailure | undefined;
          try {
            if (mode === "audit") {
              auditFault = await installAuditInsertFailure(clients[0]!, {
                action: "project.financing_quota.approve",
                businessId: fixture.quotaId
              });
            }
            const operation = service.reviewProjectFinancingQuota(
              fixture.projectId,
              fixture.quotaId,
              actorId,
              {
                actionId,
                expectedLifecycleToken: capability.lifecycleToken,
                decision: "approve",
                confirmationPassword: "local-password"
              }
            );
            if (mode === "audit") {
              const failure = await captureFailure(operation);
              expect(databaseFailureText(failure)).toContain(
                "pfq_audit_insert_failure"
              );
            } else {
              await expect(operation).rejects.toThrow(
                mode === "missing"
                  ? "审批手写签名未配置"
                  : "审批手写签名版本校验失败"
              );
            }
            expect(await quotaLifecycleSnapshot(
              clients[0]!, fixture.quotaId, fixture.approvalId
            )).toEqual(before);
            expect(await clients[0]!.approvalActionLog.count({
              where: { id: actionId }
            })).toBe(0);
          } finally {
            if (auditFault) {
              await dropAuditInsertFailure(clients[0]!, auditFault);
            }
          }
        }
      } finally {
        await disconnect(clients);
      }
    },
    120_000
  );

  integrationTest(
    "F3 replays one actionId and gives one winner to competing actionIds",
    async () => {
      const clients = clientsForTest();
      const marker = randomUUID();
      try {
        const actorId = id(marker, "f3-actor");
        const replay = await seedApprovedQuota(
          clients[0]!, marker, "f3-replay", actorId
        );
        await seedSignature(clients[0]!, actorId, `f3-${marker}`, SHA_A);
        const services = clients.map((client) => projectService(client!));
        const capability =
          await services[0]!.getProjectFinancingQuotaTerminationCapability(
            replay.projectId,
            replay.quotaId,
            actorId
          );
        const actionId = randomUUID();
        const input = {
          actionId,
          expectedLifecycleToken: capability.lifecycleToken,
          reason: "F3 同 actionId 重放",
          confirmationPassword: "local-password"
        };
        const replayResults = await runOverlappingCommittedReplay({
          firstClient: clients[0]!,
          secondClient: clients[1]!,
          invoke: (client) =>
            projectService(client).terminateProjectFinancingQuota(
              replay.projectId,
              replay.quotaId,
              actorId,
              input
            )
        });
        expect(replayResults.every((result) => result.status === "fulfilled"))
          .toBe(true);
        expect(replayResults.map((result) =>
          result.status === "fulfilled" ? result.value.kind : "rejected"
        ).sort()).toEqual(["applied", "replayed"]);
        expect(await clients[0]!.auditLog.count({
          where: {
            action: "project.financing_quota.terminate",
            businessId: replay.quotaId
          }
        })).toBe(1);

        const race = await seedApprovedQuota(
          clients[0]!, marker, "f3-action-race", actorId
        );
        const raceCapability =
          await services[0]!.getProjectFinancingQuotaTerminationCapability(
            race.projectId,
            race.quotaId,
            actorId
          );
        const raceResults = await runBehindProjectRowLock({
          blockerClient: clients[2]!,
          observerClient: clients[3]!,
          projectId: race.projectId,
          start: () => [
            services[0]!.terminateProjectFinancingQuota(
              race.projectId,
              race.quotaId,
              actorId,
              {
                actionId: randomUUID(),
                expectedLifecycleToken: raceCapability.lifecycleToken,
                reason: "F3 不同 actionId 单赢家",
                confirmationPassword: "local-password"
              }
            ),
            services[1]!.terminateProjectFinancingQuota(
              race.projectId,
              race.quotaId,
              actorId,
              {
                actionId: randomUUID(),
                expectedLifecycleToken: raceCapability.lifecycleToken,
                reason: "F3 不同 actionId 单赢家",
                confirmationPassword: "local-password"
              }
            )
          ]
        });
        expectOneStableConflict(
          raceResults,
          "项目垫资额度终止发生并发冲突，请刷新后重试"
        );
        const raceQuota =
          await clients[0]!.projectFinancingQuota.findUniqueOrThrow({
            where: { id: race.quotaId }
          });
        expect(raceQuota).toMatchObject({
          status: "terminated",
          terminationActionId: expect.any(String),
          terminationRequestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u)
        });
        expect(await clients[0]!.auditLog.count({
          where: {
            action: "project.financing_quota.terminate",
            businessId: race.quotaId
          }
        })).toBe(1);
      } finally {
        await disconnect(clients);
      }
    },
    120_000
  );

  integrationTest(
    "F3 races termination against allocation with exactly one winner",
    async () => {
      const clients = clientsForTest();
      const marker = randomUUID();
      const funding = new ProjectFundingAvailabilityService();
      try {
        const actorId = id(marker, "f3-order-actor");
        const fixture = await seedApprovedQuota(
          clients[0]!, marker, "f3-terminate-allocation-race", actorId
        );
        await seedSignature(
          clients[0]!, actorId, `f3-race-${marker}`, SHA_A
        );
        const service = projectService(clients[0]!, undefined, funding);
        const capability =
          await service.getProjectFinancingQuotaTerminationCapability(
            fixture.projectId,
            fixture.quotaId,
            actorId
          );
        const terminationActionId = randomUUID();
        const terminationReason = "真实终止与分配竞态";
        const allocationInput = fundingInput(
          fixture.projectId,
          marker,
          "terminate-allocation-race"
        );
        const operations = await startBehindProjectRowLock<unknown>({
          blockerClient: clients[2]!,
          observerClient: clients[3]!,
          projectId: fixture.projectId,
          start: () => [
            service.terminateProjectFinancingQuota(
              fixture.projectId,
              fixture.quotaId,
              actorId,
              {
                actionId: terminationActionId,
                expectedLifecycleToken: capability.lifecycleToken,
                reason: terminationReason,
                confirmationPassword: "local-password"
              }
            ),
            clients[1]!.$transaction(
              (tx) => funding.allocateExecution(
                tx,
                allocationInput
              ),
              {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable
              }
            )
          ]
        });
        const results = await Promise.allSettled([
          operations[0]!,
          operations[1]!
        ]);
        expect(results.filter((result) => result.status === "fulfilled"))
          .toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected"))
          .toHaveLength(1);

        const [quota, approval, allocations, terminateAudits] = await Promise.all([
          clients[0]!.projectFinancingQuota.findUniqueOrThrow({
            where: { id: fixture.quotaId }
          }),
          clients[0]!.approvalInstance.findUniqueOrThrow({
            where: { id: fixture.approvalId }
          }),
          clients[0]!.projectFundingAllocation.findMany({
            where: { projectId: fixture.projectId },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }]
          }),
          clients[0]!.auditLog.findMany({
            where: {
              action: "project.financing_quota.terminate",
              businessId: fixture.quotaId
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }]
          })
        ]);
        expect(approval).toMatchObject({
          status: "approved",
          currentNodeIndex: 2
        });
        const terminationResult = results[0]!;
        const allocationResult = results[1]!;
        if (terminationResult.status === "fulfilled") {
          expect(terminationResult.value).toMatchObject({ kind: "applied" });
          expect(allocationResult.status).toBe("rejected");
          if (allocationResult.status === "rejected") {
            expectDatabaseSerializationFailure(allocationResult.reason);
          }
          expect(quota).toMatchObject({
            status: "terminated",
            terminatedByUserId: actorId,
            terminationReason,
            terminationActionId,
            terminationSignatureSha256: SHA_A,
            terminationRequestFingerprint: expect.stringMatching(
              /^[a-f0-9]{64}$/u
            )
          });
          expect(allocations).toEqual([]);
          expect(terminateAudits).toHaveLength(1);
          expect(terminateAudits[0]?.metadata).toMatchObject({
            actionId: terminationActionId,
            projectId: fixture.projectId,
            quotaId: fixture.quotaId,
            netUsedAmountCents: "0",
            remainingAmountCents: "2000"
          });
        } else {
          expectStableConflictFailure(
            terminationResult.reason,
            "项目垫资额度终止发生并发冲突，请刷新后重试"
          );
          expect(allocationResult.status).toBe("fulfilled");
          if (allocationResult.status === "fulfilled") {
            expect(allocationResult.value).toMatchObject({ kind: "allocated" });
          }
          expect(quota).toMatchObject({
            status: "approved",
            terminatedAt: null,
            terminatedByUserId: null,
            terminationReason: null,
            terminationSignatureFileId: null,
            terminationSignatureSha256: null,
            terminationSignatureVersionId: null,
            terminationActionId: null,
            terminationRequestFingerprint: null
          });
          expect(allocations).toHaveLength(1);
          expect(allocations[0]).toMatchObject({
            projectId: fixture.projectId,
            executionType: allocationInput.executionType,
            executionId: allocationInput.executionId,
            businessType: allocationInput.businessType,
            businessId: allocationInput.businessId,
            sourceType: "financing_quota",
            sourceId: fixture.quotaId,
            sourceKey: `financing_quota:${fixture.quotaId}`,
            direction: "debit",
            amountCents: 500n,
            createdByUserId: actorId,
            reversalKey: "original"
          });
          expect(terminateAudits).toEqual([]);
        }
      } finally {
        await disconnect(clients);
      }
    },
    120_000
  );

  integrationTest(
    "F3 proves controlled termination-first and payment-first serializations",
    async () => {
      const clients = clientsForTest();
      const marker = randomUUID();
      const funding = new ProjectFundingAvailabilityService();
      try {
        const actorId = id(marker, "f3-order-actor");
        const terminationFirst = await seedApprovedQuota(
          clients[0]!, marker, "f3-termination-first", actorId
        );
        const paymentFirst = await seedApprovedQuota(
          clients[0]!, marker, "f3-payment-first", actorId
        );
        await seedSignature(clients[0]!, actorId, `f3-order-${marker}`, SHA_A);
        const service = projectService(clients[0]!, undefined, funding);

        const terminationFirstCapability =
          await service.getProjectFinancingQuotaTerminationCapability(
            terminationFirst.projectId,
            terminationFirst.quotaId,
            actorId
          );
        await service.terminateProjectFinancingQuota(
          terminationFirst.projectId,
          terminationFirst.quotaId,
          actorId,
          {
            actionId: randomUUID(),
            expectedLifecycleToken: terminationFirstCapability.lifecycleToken,
            reason: "termination-first",
            confirmationPassword: "local-password"
          }
        );
        await expect(clients[1]!.$transaction(
          (tx) => funding.allocateExecution(tx, fundingInput(
            terminationFirst.projectId,
            marker,
            "termination-first"
          )),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        )).rejects.toThrow("项目可用资金不足");
        expect(await clients[0]!.projectFundingAllocation.count({
          where: { projectId: terminationFirst.projectId }
        })).toBe(0);

        const staleCapability =
          await service.getProjectFinancingQuotaTerminationCapability(
            paymentFirst.projectId,
            paymentFirst.quotaId,
            actorId
          );
        await clients[1]!.$transaction(
          (tx) => funding.allocateExecution(tx, fundingInput(
            paymentFirst.projectId,
            marker,
            "payment-first"
          )),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
        await expect(service.terminateProjectFinancingQuota(
          paymentFirst.projectId,
          paymentFirst.quotaId,
          actorId,
          {
            actionId: randomUUID(),
            expectedLifecycleToken: staleCapability.lifecycleToken,
            reason: "payment-first-stale",
            confirmationPassword: "local-password"
          }
        )).rejects.toThrow("项目垫资额度终止事实已变化");
        const freshCapability =
          await service.getProjectFinancingQuotaTerminationCapability(
            paymentFirst.projectId,
            paymentFirst.quotaId,
            actorId
          );
        await service.terminateProjectFinancingQuota(
          paymentFirst.projectId,
          paymentFirst.quotaId,
          actorId,
          {
            actionId: randomUUID(),
            expectedLifecycleToken: freshCapability.lifecycleToken,
            reason: "payment-first-applied",
            confirmationPassword: "local-password"
          }
        );
        expect(await clients[0]!.projectFundingAllocation.aggregate({
          where: { projectId: paymentFirst.projectId },
          _count: true,
          _sum: { amountCents: true }
        })).toMatchObject({ _count: 1, _sum: { amountCents: 500n } });
      } finally {
        await disconnect(clients);
      }
    },
    120_000
  );

  integrationTest(
    "F3 missing or drifted signatures and Audit failure leave terminal and Audit facts unchanged",
    async () => {
      const clients = clientsForTest();
      const marker = randomUUID();
      try {
        for (const mode of ["missing", "sha-drift", "audit"] as const) {
          const actorId = id(marker, `f3-${mode}-actor`);
          const fixture = await seedApprovedQuota(
            clients[0]!, marker, `f3-${mode}`, actorId
          );
          if (mode === "sha-drift") {
            await seedSignature(
              clients[0]!, actorId, `${mode}-${marker}`, SHA_B, SHA_A
            );
          } else if (mode === "audit") {
            await seedSignature(
              clients[0]!, actorId, `${mode}-${marker}`, SHA_A
            );
          }
          const service = projectService(clients[0]!);
          const before = await quotaLifecycleSnapshot(
            clients[0]!, fixture.quotaId, fixture.approvalId
          );
          const capability =
            await service.getProjectFinancingQuotaTerminationCapability(
              fixture.projectId,
              fixture.quotaId,
              actorId
            );
          const actionId = randomUUID();
          let auditFault: AuditInsertFailure | undefined;
          try {
            if (mode === "audit") {
              auditFault = await installAuditInsertFailure(clients[0]!, {
                action: "project.financing_quota.terminate",
                businessId: fixture.quotaId
              });
            }
            const operation = service.terminateProjectFinancingQuota(
              fixture.projectId,
              fixture.quotaId,
              actorId,
              {
                actionId,
                expectedLifecycleToken: capability.lifecycleToken,
                reason: `F3 ${mode} 零写`,
                confirmationPassword: "local-password"
              }
            );
            if (mode === "audit") {
              const failure = await captureFailure(operation);
              expect(databaseFailureText(failure)).toContain(
                "pfq_audit_insert_failure"
              );
            } else {
              await expect(operation).rejects.toThrow(
                mode === "missing"
                  ? "审批手写签名未配置"
                  : "审批手写签名版本校验失败"
              );
            }
            expect(await quotaLifecycleSnapshot(
              clients[0]!, fixture.quotaId, fixture.approvalId
            )).toEqual(before);
          } finally {
            if (auditFault) {
              await dropAuditInsertFailure(clients[0]!, auditFault);
            }
          }
        }
      } finally {
        await disconnect(clients);
      }
    },
    120_000
  );

  integrationTest(
    "maps real PostgreSQL SQLSTATE variants through F2 and F3 production catches",
    async () => {
      const clients = clientsForTest();
      const marker = randomUUID();
      try {
        for (const scenario of [
          { domain: "review", sqlState: "40001", shape: "p2010" },
          { domain: "review", sqlState: "40P01", shape: "p2010" },
          { domain: "terminate", sqlState: "40001", shape: "p2010" },
          { domain: "terminate", sqlState: "40P01", shape: "p2010" },
          { domain: "review", sqlState: "40P01", shape: "top-level" },
          { domain: "terminate", sqlState: "40001", shape: "top-level" }
        ] as const) {
          const label = [scenario.domain, scenario.sqlState, scenario.shape]
            .join("-");
          const actorId = id(marker, `${label}-actor`);
          let fault: SqlStateFailure | undefined;
          if (scenario.domain === "review") {
            const fixture = await seedPendingQuota(
              clients[0]!, marker, label
            );
            await seedActor(
              clients[0]!, fixture.projectId, actorId, "finance_director"
            );
            await seedSignature(
              clients[0]!, actorId, `${label}-${marker}`, SHA_A
            );
            const capability = await projectService(clients[0]!)
              .getProjectFinancingQuotaReviewCapability(
                fixture.projectId,
                fixture.quotaId,
                actorId
              );
            const before = await quotaLifecycleSnapshot(
              clients[0]!, fixture.quotaId, fixture.approvalId
            );
            try {
              fault = await installSqlStateFailure(
                clients[0]!, scenario.sqlState
              );
              const service = projectService(
                clients[0]!,
                databaseSqlStateAudit(fault, scenario.shape)
              );
              const failure = await captureFailure(
                service.reviewProjectFinancingQuota(
                  fixture.projectId,
                  fixture.quotaId,
                  actorId,
                  {
                    actionId: randomUUID(),
                    expectedLifecycleToken: capability.lifecycleToken,
                    decision: "approve",
                    confirmationPassword: "local-password"
                  }
                )
              );
              expectStableConflictFailure(
                failure,
                "项目垫资额度审批发生并发冲突，请刷新后重试"
              );
              expect(await quotaLifecycleSnapshot(
                clients[0]!, fixture.quotaId, fixture.approvalId
              )).toEqual(before);
            } finally {
              if (fault) {
                await dropSqlStateFailure(clients[0]!, fault);
                fault = undefined;
              }
            }
          } else {
            const fixture = await seedApprovedQuota(
              clients[0]!, marker, label, actorId
            );
            await seedSignature(
              clients[0]!, actorId, `${label}-${marker}`, SHA_A
            );
            const capability = await projectService(clients[0]!)
              .getProjectFinancingQuotaTerminationCapability(
                fixture.projectId,
                fixture.quotaId,
                actorId
              );
            const before = await quotaLifecycleSnapshot(
              clients[0]!, fixture.quotaId, fixture.approvalId
            );
            try {
              fault = await installSqlStateFailure(
                clients[0]!, scenario.sqlState
              );
              const service = projectService(
                clients[0]!,
                databaseSqlStateAudit(fault, scenario.shape)
              );
              const failure = await captureFailure(
                service.terminateProjectFinancingQuota(
                  fixture.projectId,
                  fixture.quotaId,
                  actorId,
                  {
                    actionId: randomUUID(),
                    expectedLifecycleToken: capability.lifecycleToken,
                    reason: `真实 SQLSTATE ${scenario.sqlState}`,
                    confirmationPassword: "local-password"
                  }
                )
              );
              expectStableConflictFailure(
                failure,
                "项目垫资额度终止发生并发冲突，请刷新后重试"
              );
              expect(await quotaLifecycleSnapshot(
                clients[0]!, fixture.quotaId, fixture.approvalId
              )).toEqual(before);
            } finally {
              if (fault) {
                await dropSqlStateFailure(clients[0]!, fault);
                fault = undefined;
              }
            }
          }
        }
      } finally {
        await disconnect(clients);
      }
    },
    120_000
  );

  integrationTest(
    "maps natural Serializable P2034 conflicts to stable F2 and F3 409s with zero writes",
    async () => {
      const clients = clientsForTest();
      const marker = randomUUID();
      try {
        const review = await seedPendingQuota(
          clients[0]!, marker, "natural-p2034-review"
        );
        const reviewActorId = id(marker, "natural-p2034-review-actor");
        await seedActor(
          clients[0]!, review.projectId, reviewActorId, "finance_director"
        );
        await seedSignature(
          clients[0]!, reviewActorId, `natural-review-${marker}`, SHA_A
        );
        const reviewCapability = await projectService(clients[0]!)
          .getProjectFinancingQuotaReviewCapability(
            review.projectId,
            review.quotaId,
            reviewActorId
          );
        const reviewBefore = await quotaLifecycleSnapshot(
          clients[0]!, review.quotaId, review.approvalId
        );
        const reviewDatabaseFailure = deferred<unknown>();
        const reviewService = projectService(transactionErrorProbeClient(
          clients[0]!, reviewDatabaseFailure
        ));
        const reviewFailure = await forceProjectRowSerializationConflict({
          blockerClient: clients[2]!,
          observerClient: clients[3]!,
          projectId: review.projectId,
          start: () => reviewService.reviewProjectFinancingQuota(
            review.projectId,
            review.quotaId,
            reviewActorId,
            {
              actionId: randomUUID(),
              expectedLifecycleToken: reviewCapability.lifecycleToken,
              decision: "approve",
              confirmationPassword: "local-password"
            }
          )
        });
        expectStableConflictFailure(
          reviewFailure,
          "项目垫资额度审批发生并发冲突，请刷新后重试"
        );
        const rawReviewDatabaseFailure = await withTimeout(
          reviewDatabaseFailure.promise,
          10_000,
          "F2 P2034 原始数据库错误未及时捕获"
        );
        expect((rawReviewDatabaseFailure as { code?: unknown }).code)
          .toBe("P2034");
        expect(await quotaLifecycleSnapshot(
          clients[0]!, review.quotaId, review.approvalId
        )).toEqual(reviewBefore);

        const terminateActorId = id(marker, "natural-p2034-terminate-actor");
        const terminate = await seedApprovedQuota(
          clients[0]!,
          marker,
          "natural-p2034-terminate",
          terminateActorId
        );
        await seedSignature(
          clients[0]!,
          terminateActorId,
          `natural-terminate-${marker}`,
          SHA_A
        );
        const terminateCapability = await projectService(clients[0]!)
          .getProjectFinancingQuotaTerminationCapability(
            terminate.projectId,
            terminate.quotaId,
            terminateActorId
          );
        const terminateBefore = await quotaLifecycleSnapshot(
          clients[0]!, terminate.quotaId, terminate.approvalId
        );
        const terminateDatabaseFailure = deferred<unknown>();
        const terminateService = projectService(transactionErrorProbeClient(
          clients[0]!, terminateDatabaseFailure
        ));
        const terminateFailure = await forceProjectRowSerializationConflict({
          blockerClient: clients[2]!,
          observerClient: clients[3]!,
          projectId: terminate.projectId,
          start: () => terminateService.terminateProjectFinancingQuota(
            terminate.projectId,
            terminate.quotaId,
            terminateActorId,
            {
              actionId: randomUUID(),
              expectedLifecycleToken: terminateCapability.lifecycleToken,
              reason: "真实 P2034 终止门",
              confirmationPassword: "local-password"
            }
          )
        });
        expectStableConflictFailure(
          terminateFailure,
          "项目垫资额度终止发生并发冲突，请刷新后重试"
        );
        const rawTerminateDatabaseFailure = await withTimeout(
          terminateDatabaseFailure.promise,
          10_000,
          "F3 P2034 原始数据库错误未及时捕获"
        );
        expect((rawTerminateDatabaseFailure as { code?: unknown }).code)
          .toBe("P2034");
        expect(await quotaLifecycleSnapshot(
          clients[0]!, terminate.quotaId, terminate.approvalId
        )).toEqual(terminateBefore);
      } finally {
        await disconnect(clients);
      }
    },
    120_000
  );

  integrationTest(
    "#116 trigger rejects incomplete terminal facts and freezes every terminal coordinate",
    async () => {
      const clients = clientsForTest();
      const marker = randomUUID();
      try {
        const actorId = id(marker, "trigger-actor");
        const transition = await seedApprovedQuota(
          clients[0]!, marker, "trigger-transition", actorId
        );
        const signature = await seedSignature(
          clients[0]!, actorId, `trigger-${marker}`, SHA_A
        );
        const alternateSignatureFileId = id(
          marker,
          "trigger-alternate-signature-file"
        );
        await seedFile(
          clients[0]!, alternateSignatureFileId, actorId, SHA_B
        );
        const alternateSignature = await seedSignature(
          clients[0]!, actorId, `trigger-alternate-version-${marker}`, SHA_B
        );
        const transitionError = await captureFailure(
          clients[0]!.projectFinancingQuota.update({
            where: { id: transition.quotaId },
            data: {
              status: "terminated",
              terminatedAt: new Date(),
              terminatedByUserId: actorId,
              terminationReason: "缺少耐久动作坐标",
              terminationSignatureFileId: signature.fileId,
              terminationSignatureSha256: SHA_A,
              terminationSignatureVersionId: signature.versionId
            }
          })
        );
        expect(databaseFailureText(transitionError)).toMatch(
          /23514|new project financing quota terminations require durable action facts/u
        );
        expect((await clients[0]!.projectFinancingQuota.findUniqueOrThrow({
          where: { id: transition.quotaId }
        })).status).toBe("approved");

        const insertProjectId = id(marker, "trigger-insert-project");
        const insertAttachmentId = id(marker, "trigger-insert-attachment");
        await seedProject(
          clients[0]!, insertProjectId, marker, "trigger insert"
        );
        await seedFile(clients[0]!, insertAttachmentId, actorId, SHA_B);
        const insertError = await captureFailure(
          clients[0]!.projectFinancingQuota.create({
            data: {
              id: id(marker, "trigger-insert-quota"),
              projectId: insertProjectId,
              amountCents: 1000n,
              reason: "trigger insert",
              validUntil: null,
              attachmentFileId: insertAttachmentId,
              attachmentFileSha256Snapshot: SHA_B,
              requestedByUserId: actorId,
              requestedByRoleKey: "finance_staff",
              requestIdempotencyKey: randomUUID(),
              requestFingerprint: SHA_C,
              approvedByUserId: actorId,
              approvedAt: new Date(),
              status: "terminated",
              terminatedAt: new Date(),
              terminatedByUserId: actorId,
              terminationReason: "trigger insert",
              terminationSignatureFileId: signature.fileId,
              terminationSignatureSha256: SHA_A,
              terminationSignatureVersionId: signature.versionId
            }
          })
        );
        expect(databaseFailureText(insertError)).toMatch(
          /23514|new project financing quota terminations require durable action facts/u
        );

        const service = projectService(clients[0]!);
        const capability =
          await service.getProjectFinancingQuotaTerminationCapability(
            transition.projectId,
            transition.quotaId,
            actorId
          );
        await service.terminateProjectFinancingQuota(
          transition.projectId,
          transition.quotaId,
          actorId,
          {
            actionId: randomUUID(),
            expectedLifecycleToken: capability.lifecycleToken,
            reason: "trigger immutable",
            confirmationPassword: "local-password"
          }
        );
        const terminalBeforeMutations =
          await clients[0]!.projectFinancingQuota.findUniqueOrThrow({
            where: { id: transition.quotaId }
          });
        const mutationContext: TerminationImmutableMutationContext = {
          alternateActorId: transition.requesterId,
          alternateSignatureFileId,
          alternateSignatureVersionId: alternateSignature.versionId
        };
        for (const mutation of TERMINATION_IMMUTABLE_MUTATIONS) {
          const immutableError = await captureFailure(
            mutation.execute(
              clients[0]!,
              transition.quotaId,
              mutationContext
            )
          );
          expect(databaseFailureText(immutableError)).toMatch(
            /23514|project financing quota termination facts are immutable/u
          );
        }
        const terminalAfterMutations =
          await clients[0]!.projectFinancingQuota.findUniqueOrThrow({
            where: { id: transition.quotaId }
          });
        expect(terminalAfterMutations).toEqual(terminalBeforeMutations);
      } finally {
        await disconnect(clients);
      }
    },
    120_000
  );
});

function clientsForTest() {
  const databaseUrl = projectFinancingQuotaDatabaseUrl(
    process.env.PROJECT_FINANCING_QUOTA_DATABASE_URL
  );
  return [0, 1, 2, 3].map(() => new PrismaClient({
    datasources: { db: { url: databaseUrl } }
  }));
}

function projectService(
  client: PrismaClient,
  audit?: { record: (...args: unknown[]) => Promise<unknown> },
  funding = new ProjectFundingAvailabilityService()
) {
  return new ProjectService(
    client as never,
    audit as never,
    { confirmPassword: jest.fn().mockResolvedValue(undefined) } as never,
    funding
  );
}

function id(marker: string, suffix: string) {
  return `pfq-${suffix}-${marker}`;
}

async function seedProject(
  client: PrismaClient,
  projectId: string,
  marker: string,
  label: string
) {
  await client.project.create({
    data: {
      id: projectId,
      code: `PFQ-${marker.slice(0, 8)}-${label}-${projectId.slice(-8)}`,
      name: `项目垫资额度实库夹具 ${label}`
    }
  });
}

async function seedActor(
  client: PrismaClient,
  projectId: string,
  actorId: string,
  role: string
) {
  await client.user.upsert({
    where: { id: actorId },
    update: {},
    create: { id: actorId, name: `实库门禁 ${role}` }
  });
  await client.projectMember.createMany({
    data: [{ projectId, userId: actorId, positionKey: role }],
    skipDuplicates: true
  });
}

async function seedFile(
  client: PrismaClient,
  fileId: string,
  actorId: string,
  sha256: string
) {
  await client.fileObject.create({
    data: {
      id: fileId,
      bucket: "local-test",
      objectKey: `project-financing-quota/${fileId}`,
      originalName: `${fileId}.bin`,
      mimeType: "application/octet-stream",
      sizeBytes: 128,
      uploadedByUserId: actorId,
      contentSha256: sha256,
      storageStatus: "active"
    }
  });
}

async function seedSignature(
  client: PrismaClient,
  actorId: string,
  label: string,
  fileSha256: string,
  versionSha256 = fileSha256
) {
  const fileId = `pfq-signature-file-${label}`;
  const versionId = `pfq-signature-version-${label}`;
  await seedFile(client, fileId, actorId, fileSha256);
  await client.handwrittenSignatureVersion.create({
    data: {
      id: versionId,
      userId: actorId,
      fileId,
      contentSha256: versionSha256,
      source: "canvas"
    }
  });
  return { fileId, versionId };
}

async function seedPendingQuota(
  client: PrismaClient,
  marker: string,
  label: string
) {
  const projectId = id(marker, `${label}-project`);
  const requesterId = id(marker, `${label}-requester`);
  const attachmentFileId = id(marker, `${label}-attachment`);
  const quotaId = id(marker, `${label}-quota`);
  const approvalId = id(marker, `${label}-approval`);
  await seedProject(client, projectId, marker, label);
  await seedActor(client, projectId, requesterId, "finance_staff");
  await seedFile(client, attachmentFileId, requesterId, SHA_B);
  await client.projectFinancingQuota.create({
    data: {
      id: quotaId,
      projectId,
      amountCents: 2000n,
      reason: `${label} 待审额度`,
      validUntil: null,
      attachmentFileId,
      attachmentFileSha256Snapshot: SHA_B,
      requestedByUserId: requesterId,
      requestedByRoleKey: "finance_staff",
      requestIdempotencyKey: randomUUID(),
      requestFingerprint: SHA_C,
      status: "approval_pending"
    }
  });
  await client.approvalInstance.create({
    data: {
      id: approvalId,
      flowType: "project_financing_quota.approve",
      businessType: "project_financing_quota",
      businessId: quotaId,
      status: "in_progress",
      currentNodeIndex: 0,
      frozenNodes: PENDING_NODES,
      applicantUserId: requesterId
    }
  });
  return { projectId, requesterId, quotaId, approvalId };
}

async function seedApprovedQuota(
  client: PrismaClient,
  marker: string,
  label: string,
  financeDirectorId: string
) {
  const projectId = id(marker, `${label}-project`);
  const requesterId = id(marker, `${label}-requester`);
  const attachmentFileId = id(marker, `${label}-attachment`);
  const quotaId = id(marker, `${label}-quota`);
  const approvalId = id(marker, `${label}-approval`);
  const finalApproverId = id(marker, `${label}-chairman`);
  await seedProject(client, projectId, marker, label);
  await seedActor(client, projectId, requesterId, "finance_staff");
  if (financeDirectorId !== requesterId) {
    await seedActor(
      client, projectId, financeDirectorId, "finance_director"
    );
  }
  await seedActor(client, projectId, finalApproverId, "chairman");
  await seedFile(client, attachmentFileId, requesterId, SHA_B);
  await client.projectFinancingQuota.create({
    data: {
      id: quotaId,
      projectId,
      amountCents: 2000n,
      reason: `${label} 已批准额度`,
      validUntil: null,
      attachmentFileId,
      attachmentFileSha256Snapshot: SHA_B,
      requestedByUserId: requesterId,
      requestedByRoleKey: "finance_staff",
      requestIdempotencyKey: randomUUID(),
      requestFingerprint: SHA_C,
      approvedByUserId: finalApproverId,
      approvedAt: new Date(),
      status: "approved"
    }
  });
  await client.approvalInstance.create({
    data: {
      id: approvalId,
      flowType: "project_financing_quota.approve",
      businessType: "project_financing_quota",
      businessId: quotaId,
      status: "approved",
      currentNodeIndex: 2,
      frozenNodes: APPROVED_NODES,
      applicantUserId: requesterId
    }
  });
  return {
    projectId,
    requesterId,
    quotaId,
    approvalId,
    finalApproverId
  };
}

function fundingInput(projectId: string, marker: string, label: string) {
  return {
    projectId,
    executionType: "payment_execution" as const,
    executionId: id(marker, `${label}-execution`),
    businessType: "payment_request",
    businessId: id(marker, `${label}-business`),
    amountCents: 500n,
    occurredAt: new Date(),
    actorUserId: id(marker, "f3-order-actor")
  };
}

async function quotaLifecycleSnapshot(
  client: PrismaClient,
  quotaId: string,
  approvalId: string
) {
  const [quota, approval, actions, audits] = await Promise.all([
    client.projectFinancingQuota.findUniqueOrThrow({
      where: { id: quotaId }
    }),
    client.approvalInstance.findUniqueOrThrow({
      where: { id: approvalId }
    }),
    client.approvalActionLog.findMany({
      where: { approvalInstanceId: approvalId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    }),
    client.auditLog.findMany({
      where: {
        businessType: "project_financing_quota",
        businessId: quotaId
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    })
  ]);
  return { quota, approval, actions, audits };
}

async function projectFinancingBusinessCounts(
  client: PrismaClient,
  projectId: string,
  actorUserId: string
) {
  const [quotas, approvals, audits] = await Promise.all([
    client.projectFinancingQuota.count({ where: { projectId } }),
    client.approvalInstance.count({
      where: {
        businessType: "project_financing_quota",
        applicantUserId: actorUserId
      }
    }),
    client.auditLog.count({
      where: {
        businessType: "project_financing_quota",
        actorUserId
      }
    })
  ]);
  return { quotas, approvals, audits };
}

interface ProjectRowLockRace<T> {
  blockerClient: PrismaClient;
  observerClient: PrismaClient;
  projectId: string;
  start: () => Array<Promise<T>>;
}

interface TransactionProbeOptions {
  afterCommit?: () => Promise<void>;
}

async function runOverlappingCommittedReplay<T>({
  firstClient,
  secondClient,
  invoke
}: {
  firstClient: PrismaClient;
  secondClient: PrismaClient;
  invoke: (client: PrismaClient) => Promise<T>;
}): Promise<Array<PromiseSettledResult<T>>> {
  const firstStarted = deferred<number>();
  const secondStarted = deferred<number>();
  const firstCommitted = deferred<void>();
  const releaseFirstResponse = deferred<void>();
  const probedFirst = transactionProbeClient(firstClient, firstStarted, {
    afterCommit: async () => {
      // The database transaction is already committed. Only the first service
      // response is held so the second backend can prove a durable replay.
      firstCommitted.resolve();
      await withTimeout(
        releaseFirstResponse.promise,
        10_000,
        "首个已提交重放请求未收到响应释放信号"
      );
    }
  });
  const probedSecond = transactionProbeClient(secondClient, secondStarted);
  const firstOperation = invoke(probedFirst);
  void firstOperation.catch(() => undefined);
  let secondOperation: Promise<T> | undefined;
  let secondResult: Array<PromiseSettledResult<T>> | undefined;
  try {
    await withTimeout(
      Promise.race([
        firstCommitted.promise,
        firstOperation.then(
          () => Promise.reject(new Error("首个重放请求未经过提交后响应门")),
          (error) => Promise.reject(error)
        )
      ]),
      10_000,
      "首个重放请求未在期限内提交"
    );
    secondOperation = invoke(probedSecond);
    void secondOperation.catch(() => undefined);
    secondResult = await withTimeout(
      Promise.allSettled([secondOperation]),
      10_000,
      "第二个 durable replay 请求未及时收口"
    );
  } catch (error) {
    releaseFirstResponse.resolve();
    await withTimeout(
      Promise.allSettled([
        firstOperation,
        ...(secondOperation ? [secondOperation] : [])
      ]),
      10_000,
      "durable replay 失败后的请求未及时释放"
    ).catch(() => undefined);
    throw error;
  } finally {
    releaseFirstResponse.resolve();
  }
  if (!secondOperation || !secondResult) {
    throw new Error("durable replay 未启动第二个 backend 请求");
  }
  const results = await withTimeout(
    Promise.allSettled([firstOperation, secondOperation]),
    10_000,
    "durable replay 双请求未及时收口"
  );
  const [firstBackendPid, secondBackendPid] = await withTimeout(
    Promise.all([firstStarted.promise, secondStarted.promise]),
    10_000,
    "durable replay backend PID 未及时采集"
  );
  expect(firstBackendPid).not.toBe(secondBackendPid);
  expect(secondResult[0]?.status).toBe("fulfilled");
  return results;
}

function transactionProbeClient(
  client: PrismaClient,
  started: ReturnType<typeof deferred<number>>,
  options: TransactionProbeOptions = {}
) {
  const transaction = async (
    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    transactionOptions?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    }
  ) => {
    if (typeof callback !== "function") {
      throw new Error("项目垫资额度事务探针只接受交互式事务");
    }
    const result = await client.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>(
        Prisma.sql`SELECT pg_backend_pid()::int AS pid`
      );
      if (!backend) {
        throw new Error("无法识别项目垫资额度重放事务 backend");
      }
      started.resolve(backend.pid);
      return callback(tx);
    }, transactionOptions);
    await options.afterCommit?.();
    return result;
  };
  return new Proxy(client, {
    get(target, property) {
      if (property === "$transaction") return transaction;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as PrismaClient;
}

function transactionErrorProbeClient(
  client: PrismaClient,
  observedFailure: ReturnType<typeof deferred<unknown>>
) {
  const transaction = async (
    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    transactionOptions?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    }
  ) => {
    try {
      return await client.$transaction(callback, transactionOptions);
    } catch (error) {
      observedFailure.resolve(error);
      throw error;
    }
  };
  return new Proxy(client, {
    get(target, property) {
      if (property === "$transaction") return transaction;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as PrismaClient;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function withTimeout<T>(
  operation: Promise<T>,
  milliseconds: number,
  message: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutFailure = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  try {
    return await Promise.race([operation, timeoutFailure]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function startBehindProjectRowLock<T>({
  blockerClient,
  observerClient,
  projectId,
  start
}: ProjectRowLockRace<T>): Promise<Array<Promise<T>>> {
  const evidence = await startBehindProjectRowLockEvidence({
    blockerClient,
    observerClient,
    projectId,
    start
  });
  return evidence.operations;
}

async function startBehindProjectRowLockEvidence<T>({
  blockerClient,
  observerClient,
  projectId,
  start
}: ProjectRowLockRace<T>): Promise<{
  operations: Array<Promise<T>>;
  backendPids: number[];
}> {
  let operations: Array<Promise<T>> = [];
  let backendPids: number[] = [];
  try {
    await blockerClient.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>(
        Prisma.sql`SELECT pg_backend_pid()::int AS pid`
      );
      if (!backend) {
        throw new Error("无法识别项目行锁门禁的 PostgreSQL backend");
      }
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "Project"
          WHERE "id" = ${projectId}
          FOR UPDATE
        `
      );
      if (locked.length !== 1) {
        throw new Error("项目行锁门禁未锁定唯一项目");
      }
      operations = start();
      for (const operation of operations) {
        void operation.catch(() => undefined);
      }
      if (operations.length === 0) {
        throw new Error("项目行锁门禁没有待并发操作");
      }
      backendPids = await waitForBlockedBackends(
        observerClient,
        backend.pid,
        operations.length
      );
    }, { maxWait: 5_000, timeout: 15_000 });
  } catch (error) {
    await withTimeout(
      Promise.allSettled(operations),
      10_000,
      "项目行锁门禁失败后的业务事务未及时释放"
    ).catch(() => undefined);
    throw error;
  }
  return { operations, backendPids };
}

async function runBehindProjectRowLock<T>(
  race: ProjectRowLockRace<T>
): Promise<Array<PromiseSettledResult<T>>> {
  const operations = await startBehindProjectRowLock(race);
  return Promise.allSettled(operations);
}

async function forceProjectRowSerializationConflict<T>({
  blockerClient,
  observerClient,
  projectId,
  start
}: {
  blockerClient: PrismaClient;
  observerClient: PrismaClient;
  projectId: string;
  start: () => Promise<T>;
}) {
  let operation: Promise<T> | undefined;
  await blockerClient.$transaction(async (tx) => {
    const [backend] = await tx.$queryRaw<Array<{ pid: number }>>(
      Prisma.sql`SELECT pg_backend_pid()::int AS pid`
    );
    if (!backend) {
      throw new Error("无法识别 P2034 门禁的 PostgreSQL backend");
    }
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id"
        FROM "Project"
        WHERE "id" = ${projectId}
        FOR UPDATE
      `
    );
    if (locked.length !== 1) {
      throw new Error("P2034 门禁未锁定唯一项目");
    }
    operation = start();
    void operation.catch(() => undefined);
    await waitForBlockedBackends(observerClient, backend.pid, 1);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Project"
      SET "name" = "name"
      WHERE "id" = ${projectId}
    `);
  }, { maxWait: 5_000, timeout: 15_000 });
  if (!operation) {
    throw new Error("P2034 门禁未启动业务事务");
  }
  return captureFailure(operation);
}

async function waitForBlockedBackends(
  observerClient: PrismaClient,
  blockerPid: number,
  expectedCount: number
) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const rows = await observerClient.$queryRaw<Array<{ pid: number }>>(
      Prisma.sql`
      SELECT activity.pid::int AS pid
      FROM pg_stat_activity AS activity
      WHERE activity.datname = current_database()
        AND activity.pid <> pg_backend_pid()
        AND activity.wait_event_type = 'Lock'
        AND position('FROM "Project"' IN activity.query) > 0
        AND position('FOR UPDATE' IN activity.query) > 0
        AND ${blockerPid} = ANY(pg_blocking_pids(activity.pid))
      ORDER BY activity.pid
    `);
    if (rows.length >= expectedCount) {
      return rows.map((row) => row.pid);
    }
    await delay(25);
  }
  throw new Error(
    `等待 ${expectedCount} 个 PostgreSQL backend 竞争项目行锁超时`
  );
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function expectOneStableConflict<T>(
  results: Array<PromiseSettledResult<T>>,
  message: string
) {
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expectStableConflictFailure(
    (rejected[0] as PromiseRejectedResult).reason,
    message
  );
}

function expectStableConflictFailure(error: unknown, message: string) {
  const value = error as {
    getStatus?: () => number;
    message?: unknown;
  };
  expect(typeof value?.getStatus).toBe("function");
  expect(value.getStatus?.()).toBe(409);
  expect(value.message).toBe(message);
}

function expectDatabaseSerializationFailure(error: unknown) {
  const value = error as {
    code?: unknown;
    meta?: { code?: unknown };
  };
  if (value?.code === "P2034") {
    expect(value.code).toBe("P2034");
    return;
  }
  expect(value?.code).toBe("P2010");
  expect(["40001", "40P01"]).toContain(value?.meta?.code);
}

type TestSqlState = "40001" | "40P01";
type SqlStateFailureShape = "p2010" | "top-level";

interface SqlStateFailure {
  functionName: string;
  sqlState: TestSqlState;
}

async function installSqlStateFailure(
  client: PrismaClient,
  sqlState: TestSqlState
): Promise<SqlStateFailure> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const functionName = `pfq_sqlstate_failure_${suffix}`;
  await client.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"()
    RETURNS integer LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'pfq_sqlstate_failure_${sqlState}'
        USING ERRCODE = '${sqlState}';
    END;
    $$
  `);
  return { functionName, sqlState };
}

async function dropSqlStateFailure(
  client: PrismaClient,
  fault: SqlStateFailure
) {
  assertSqlIdentifier(fault.functionName);
  await client.$executeRawUnsafe(
    `DROP FUNCTION IF EXISTS "${fault.functionName}"()`
  );
}

function databaseSqlStateAudit(
  fault: SqlStateFailure,
  shape: SqlStateFailureShape
) {
  assertSqlIdentifier(fault.functionName);
  return {
    async record(...args: unknown[]) {
      const tx = args[0] as Prisma.TransactionClient;
      try {
        await tx.$queryRawUnsafe(`SELECT "${fault.functionName}"()`);
      } catch (error) {
        assertRealDatabaseSqlState(error, fault.sqlState);
        if (shape === "p2010") throw error;
        throw Object.assign(
          new Error(`pfq_real_top_level_sqlstate_${fault.sqlState}`),
          { code: fault.sqlState, databaseError: error }
        );
      }
      throw new Error("预期 PostgreSQL SQLSTATE 故障，但函数意外成功");
    }
  };
}

function assertRealDatabaseSqlState(
  error: unknown,
  expectedSqlState: TestSqlState
) {
  const value = error as {
    code?: unknown;
    meta?: { code?: unknown; message?: unknown };
  };
  if (value?.code !== "P2010" || value.meta?.code !== expectedSqlState) {
    throw new Error(
      `真实 PostgreSQL SQLSTATE 形态不符：${databaseFailureText(error)}`
    );
  }
  expect(value.code).toBe("P2010");
  expect(value.meta.code).toBe(expectedSqlState);
  expect(String(value.meta.message ?? "")).toContain(
    `pfq_sqlstate_failure_${expectedSqlState}`
  );
}

type AuditInsertFailureScope = {
  action: string;
} & (
  | { businessId: string; requestIdempotencyKey?: never }
  | { businessId?: never; requestIdempotencyKey: string }
);

interface AuditInsertFailure {
  triggerName: string;
  functionName: string;
}

async function installAuditInsertFailure(
  client: PrismaClient,
  scope: AuditInsertFailureScope
): Promise<AuditInsertFailure> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const functionName = `pfq_audit_insert_failure_${suffix}`;
  const triggerName = `pfq_audit_insert_failure_trigger_${suffix}`;
  const businessPredicate = typeof scope.businessId === "string"
    ? `NEW."businessId" = ${sqlLiteral(scope.businessId)}`
    : `EXISTS (
        SELECT 1
        FROM "ProjectFinancingQuota" quota
        WHERE quota."id" = NEW."businessId"
          AND quota."requestIdempotencyKey" = ${
            sqlLiteral(scope.requestIdempotencyKey!)
          }
      )`;

  await client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."businessType" = 'project_financing_quota'
          AND NEW."action" = ${sqlLiteral(scope.action)}
          AND ${businessPredicate}
        THEN
          RAISE EXCEPTION 'pfq_audit_insert_failure'
            USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await tx.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `);
  });
  return { triggerName, functionName };
}

async function dropAuditInsertFailure(
  client: PrismaClient,
  fault: AuditInsertFailure
) {
  assertSqlIdentifier(fault.triggerName);
  assertSqlIdentifier(fault.functionName);
  await client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${fault.triggerName}" ON "AuditLog"`
    );
    await tx.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${fault.functionName}"()`
    );
  });
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function assertSqlIdentifier(value: string) {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) {
    throw new Error("项目垫资额度实库门标识符不合法");
  }
}

async function captureFailure(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("预期 PostgreSQL 拒绝写入，但写入意外成功");
}

function databaseFailureText(error: unknown) {
  if (!error || typeof error !== "object") return String(error);
  const value = error as { message?: unknown; code?: unknown; meta?: unknown };
  return [value.message, value.code, JSON.stringify(value.meta)]
    .map((part) => String(part ?? ""))
    .join(" ");
}

async function disconnect(clients: PrismaClient[]) {
  await Promise.allSettled(clients.map((client) => client.$disconnect()));
}
