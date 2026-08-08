import { BadRequestException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { ContractEndedApplicationRetentionService } from "../contract-ended-retention/contract-ended-retention.service";

const TEST_DATABASE = "jiangkong_contract_draft_aggregate_test";

function localRetentionDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("结束申请保留测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("结束申请保留测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("contract ended application retention PostgreSQL evidence", () => {
  const integrationTest =
    process.env.RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE === "1" ? it : it.skip;

  integrationTest("calculates calendar-month retention and audits director holds without deleting data", async () => {
    const databaseUrl = localRetentionDatabaseUrl(
      process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
    );
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = `${process.pid}-${Date.now()}`;
    const directorId = `ended-retention-director-${suffix}`;
    const projectId = `ended-retention-project-${suffix}`;
    const inactiveProjectId = `ended-retention-inactive-project-${suffix}`;
    const contractId = `ended-retention-contract-${suffix}`;
    const endedVersionId = `${contractId}-ended-v1`;
    const inactiveContractId = `ended-retention-inactive-contract-${suffix}`;
    const inactiveVersionId = `${inactiveContractId}-ended-v1`;
    const effectiveContractId = `ended-retention-effective-contract-${suffix}`;
    const effectiveVersionId = `${effectiveContractId}-v1`;
    const terminalAt = new Date("2026-08-31T10:15:00.000Z");

    try {
      await prisma.user.create({
        data: { id: directorId, name: "结束申请保留测试合同部主管", mustChangePassword: false }
      });
      const contractDirectorPosition = await prisma.position.upsert({
        where: { key: "contract_director" },
        update: {},
        create: { key: "contract_director", name: "合同部主管" }
      });
      await prisma.userPosition.create({
        data: { userId: directorId, positionId: contractDirectorPosition.id }
      });
      await prisma.project.create({
        data: {
          id: projectId,
          code: `ENDED-RETENTION-${suffix}`,
          name: "结束申请保留 PostgreSQL 测试项目"
        }
      });
      await prisma.project.create({
        data: {
          id: inactiveProjectId,
          code: `ENDED-RETENTION-INACTIVE-${suffix}`,
          name: "结束申请保留停用项目",
          isActive: false
        }
      });
      await prisma.contract.create({
        data: {
          id: contractId,
          projectId,
          temporaryCode: `TMP-ENDED-RETENTION-${suffix}`,
          name: "最终驳回保留测试合同",
          counterparty: "测试相对方",
          ownerUserId: directorId
        }
      });
      await prisma.contract.create({
        data: {
          id: effectiveContractId,
          projectId,
          temporaryCode: `TMP-EFFECTIVE-RETENTION-${suffix}`,
          name: "生效合同排除测试",
          counterparty: "测试相对方",
          ownerUserId: directorId
        }
      });
      await prisma.contract.create({
        data: {
          id: inactiveContractId,
          projectId: inactiveProjectId,
          temporaryCode: `TMP-INACTIVE-RETENTION-${suffix}`,
          name: "停用项目结束申请",
          counterparty: "测试相对方",
          ownerUserId: directorId
        }
      });
      await prisma.contractVersion.createMany({
        data: [
          {
            id: endedVersionId,
            contractId,
            versionNo: 1,
            changeType: "original",
            status: "approval_rejected",
            endedAt: terminalAt,
            amountCents: 100n,
            draftData: {},
            templateSnapshot: {},
            clauseSnapshot: []
          },
          {
            id: inactiveVersionId,
            contractId: inactiveContractId,
            versionNo: 1,
            changeType: "original",
            status: "approval_rejected",
            endedAt: terminalAt,
            amountCents: 100n,
            draftData: {},
            templateSnapshot: {},
            clauseSnapshot: []
          },
          {
            id: effectiveVersionId,
            contractId: effectiveContractId,
            versionNo: 1,
            changeType: "original",
            status: "effective",
            effectiveAt: terminalAt,
            amountCents: 100n,
            draftData: {},
            templateSnapshot: {},
            clauseSnapshot: []
          }
        ]
      });

      const service = new ContractEndedApplicationRetentionService(
        prisma as never,
        new AuditService(),
        {
          effectiveRoleKeysByProject: jest.fn().mockImplementation(
            async (_actorUserId: string, projectIds: string[]) => new Map(
              projectIds.map((currentProjectId) => [currentProjectId, ["contract_director"]])
            )
          )
        } as never
      );
      const beforeExpiry = await service.preview(
        directorId,
        undefined,
        undefined,
        new Date("2026-10-31T10:15:00.000Z")
      );
      expect(beforeExpiry.candidates).toEqual([
        expect.objectContaining({
          contractVersionId: endedVersionId,
          retentionEndsAt: "2026-11-30T10:15:00.000Z",
          purgeEligibleAt: "2026-11-30T10:15:00.000Z",
          remainingDays: 30
        })
      ]);
      expect(beforeExpiry.candidates).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ contractVersionId: effectiveVersionId })])
      );
      expect(beforeExpiry.candidates).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ contractVersionId: inactiveVersionId })])
      );
      expect(beforeExpiry.executionAllowed).toBe(false);

      const created = await service.createHold(
        endedVersionId,
        directorId,
        { reason: "等待争议资料核验" },
        new Date("2026-12-02T10:15:00.000Z")
      );
      expect(created).toMatchObject({ holdCreated: true, idempotent: false });
      const heldPreview = await service.preview(
        directorId,
        undefined,
        undefined,
        new Date("2026-12-02T10:15:00.000Z")
      );
      expect(heldPreview.candidates).toHaveLength(0);
      expect(heldPreview.heldRecords).toEqual([
        expect.objectContaining({
          contractVersionId: endedVersionId,
          activeHold: expect.objectContaining({ reason: "等待争议资料核验" })
        })
      ]);

      const released = await service.releaseHold(
        endedVersionId,
        directorId,
        { reason: "争议资料已核验" },
        new Date("2026-12-02T10:15:00.000Z")
      );
      expect(released).toMatchObject({
        retentionEndsAt: "2026-11-30T10:15:00.000Z",
        releaseBufferUntil: "2027-01-01T10:15:00.000Z",
        purgeEligibleAt: "2027-01-01T10:15:00.000Z"
      });
      await expect(prisma.auditLog.findMany({
        where: { businessId: endedVersionId },
        orderBy: { action: "asc" },
        select: { action: true, actorUserId: true }
      })).resolves.toEqual([
        { action: "contract.ended_retention.hold.create", actorUserId: directorId },
        { action: "contract.ended_retention.hold.release", actorUserId: directorId }
      ]);
      await expect(service.createHold(
        effectiveVersionId,
        directorId,
        { reason: "不应允许" }
      )).rejects.toBeInstanceOf(BadRequestException);
      await expect(prisma.contractVersion.findUnique({
        where: { id: endedVersionId },
        select: { status: true }
      })).resolves.toEqual({ status: "approval_rejected" });
    } finally {
      await prisma.auditLog.deleteMany({
        where: { businessId: { in: [endedVersionId, inactiveVersionId, effectiveVersionId] } }
      });
      await prisma.contractEndedApplicationRetentionHold.deleteMany({
        where: { contractVersionId: { in: [endedVersionId, inactiveVersionId, effectiveVersionId] } }
      });
      await prisma.contractVersion.deleteMany({
        where: { id: { in: [endedVersionId, inactiveVersionId, effectiveVersionId] } }
      });
      await prisma.contract.deleteMany({
        where: { id: { in: [contractId, inactiveContractId, effectiveContractId] } }
      });
      await prisma.project.deleteMany({ where: { id: { in: [projectId, inactiveProjectId] } } });
      await prisma.userPosition.deleteMany({ where: { userId: directorId } });
      await prisma.user.deleteMany({ where: { id: directorId } });
      await prisma.$disconnect();
    }
  }, 30_000);
});
