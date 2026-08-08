import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import { addShanghaiCalendarMonths } from "../contract/contract-retention-calendar";

const DAY_MS = 86_400_000;
const RETENTION_MONTHS = 3;
const PREVIEW_WINDOW_DAYS = 30;
const ENDED_RETENTION_POLICY_ID = "contract-ended-retention-v1";
const TERMINAL_STATUSES = ["abandoned", "approval_rejected"] as const;

export interface RetentionReasonInput {
  reason: string;
}

type EndedVersion = {
  id: string;
  contractId: string;
  status: string;
  endedAt: Date | null;
  firstSubmittedAt: Date | null;
  abandonedAt: Date | null;
};

type RetentionHold = {
  id: string;
  contractVersionId: string;
  reason: string;
  createdByUserId: string;
  createdAt: Date;
  releasedAt: Date | null;
  releasedByUserId: string | null;
  releaseReason: string | null;
};

function toIso(value: Date | null) {
  return value?.toISOString() ?? null;
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}

export function addCalendarMonths(value: Date, months: number) {
  return addShanghaiCalendarMonths(value, months);
}

function remainingDays(now: Date, dueAt: Date) {
  return Math.ceil((dueAt.getTime() - now.getTime()) / DAY_MS);
}

function isRetainedEndedApplication(version: EndedVersion) {
  if (!TERMINAL_STATUSES.includes(version.status as (typeof TERMINAL_STATUSES)[number])) {
    return false;
  }
  return Boolean(version.endedAt || version.firstSubmittedAt);
}

@Injectable()
export class ContractEndedApplicationRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly projectVisibility: ProjectVisibilityService
  ) {}

  async preview(
    actorUserId: string,
    rawPage?: string | number,
    rawLimit?: string | number,
    now = new Date()
  ) {
    const page = this.page(rawPage);
    const limit = this.limit(rawLimit);
    const [policy, projectIds] = await Promise.all([
      this.prisma.contractEndedApplicationRetentionPolicy.findUnique({
        where: { id: ENDED_RETENTION_POLICY_ID }
      }),
      this.retentionProjectIds(actorUserId)
    ]);
    if (!policy) {
      throw new ConflictException("结束申请保留策略尚未初始化，拒绝生成清理预览");
    }
    const where = {
      status: { in: [...TERMINAL_STATUSES] },
      OR: [
        { endedAt: { not: null } },
        { firstSubmittedAt: { not: null } }
      ],
      contract: { projectId: { in: projectIds } }
    };
    const [total, versions] = projectIds.length
      ? await Promise.all([
          this.prisma.contractVersion.count({ where }),
          this.prisma.contractVersion.findMany({
            where,
            orderBy: [{ endedAt: "asc" }, { id: "asc" }],
            skip: (page - 1) * limit,
            take: limit
          })
        ])
      : [0, []] as const;
    const endedVersions = (versions as EndedVersion[]).filter(isRetainedEndedApplication);
    const contractIds = [...new Set(endedVersions.map((version) => version.contractId))];
    const versionIds = endedVersions.map((version) => version.id);
    const [contracts, holds] = await Promise.all([
      contractIds.length
        ? this.prisma.contract.findMany({
            where: { id: { in: contractIds } },
            select: {
              id: true,
              projectId: true,
              code: true,
              name: true,
              counterparty: true
            }
          })
        : Promise.resolve([]),
      versionIds.length
        ? this.prisma.contractEndedApplicationRetentionHold.findMany({
            where: { contractVersionId: { in: versionIds } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }]
          })
        : Promise.resolve([])
    ]);
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const holdsByVersion = new Map<string, RetentionHold[]>();
    for (const hold of holds as RetentionHold[]) {
      holdsByVersion.set(hold.contractVersionId, [
        ...(holdsByVersion.get(hold.contractVersionId) ?? []),
        hold
      ]);
    }
    const windowEndsAt = addDays(now, PREVIEW_WINDOW_DAYS);
    const records = endedVersions.flatMap((version) => {
      const contract = contractById.get(version.contractId);
      if (!contract) return [];
      const terminalAt = version.endedAt ?? policy.activatedAt;
      const retentionEndsAt = addCalendarMonths(terminalAt, RETENTION_MONTHS);
      const versionHolds = holdsByVersion.get(version.id) ?? [];
      const activeHold = versionHolds.find((hold) => hold.releasedAt == null) ?? null;
      const latestRelease = versionHolds
        .filter((hold): hold is RetentionHold & { releasedAt: Date } => hold.releasedAt instanceof Date)
        .sort((left, right) => right.releasedAt.getTime() - left.releasedAt.getTime())[0] ?? null;
      const releaseBufferUntil = latestRelease && latestRelease.releasedAt.getTime() >= retentionEndsAt.getTime()
        ? addDays(latestRelease.releasedAt, PREVIEW_WINDOW_DAYS)
        : null;
      const purgeEligibleAt = releaseBufferUntil && releaseBufferUntil > retentionEndsAt
        ? releaseBufferUntil
        : retentionEndsAt;
      return [{
        contractVersionId: version.id,
        contractId: version.contractId,
        projectId: contract.projectId,
        contractCode: contract.code,
        contractName: contract.name,
        counterparty: contract.counterparty,
        terminalStatus: version.status,
        terminalAt: terminalAt.toISOString(),
        retentionEndsAt: retentionEndsAt.toISOString(),
        releaseBufferUntil: toIso(releaseBufferUntil),
        purgeEligibleAt: purgeEligibleAt.toISOString(),
        remainingDays: remainingDays(now, purgeEligibleAt),
        activeHold: activeHold
          ? {
              id: activeHold.id,
              reason: activeHold.reason,
              createdAt: activeHold.createdAt.toISOString(),
              createdByUserId: activeHold.createdByUserId
            }
          : null
      }];
    });
    const previewable = records.filter((record) =>
      record.activeHold == null &&
      new Date(record.purgeEligibleAt).getTime() <= windowEndsAt.getTime()
    );
    return {
      generatedAt: now.toISOString(),
      mode: "preview_only" as const,
      executionAllowed: false,
      canManageRetention: true,
      retention: {
        calendarMonths: RETENTION_MONTHS,
        previewWindowDays: PREVIEW_WINDOW_DAYS
      },
      page,
      limit,
      total,
      hasMore: page * limit < total,
      candidates: previewable,
      heldRecords: records.filter((record) => record.activeHold != null),
      notice: "仅生成结束申请的只读保留预览；本接口不删除合同、审批、审计或文件。"
    };
  }

  async createHold(
    contractVersionId: string,
    actorUserId: string,
    input: RetentionReasonInput,
    now = new Date()
  ) {
    const reason = this.requiredReason(input.reason);
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });
      this.assertRetainedEndedApplication(version);
      await this.assertCanManageRetention(tx, version, actorUserId);
      const existing = await tx.contractEndedApplicationRetentionHold.findFirst({
        where: { contractVersionId, releasedAt: null },
        orderBy: { createdAt: "desc" }
      });
      if (existing) {
        return {
          contractVersionId,
          holdCreated: false,
          idempotent: true,
          holdId: existing.id,
          reason: existing.reason
        };
      }
      const hold = await tx.contractEndedApplicationRetentionHold.create({
        data: { contractVersionId, reason, createdByUserId: actorUserId, createdAt: now }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.ended_retention.hold.create",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: { reason, holdId: hold.id }
      });
      return {
        contractVersionId,
        holdCreated: true,
        idempotent: false,
        holdId: hold.id,
        reason
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async releaseHold(
    contractVersionId: string,
    actorUserId: string,
    input: RetentionReasonInput,
    now = new Date()
  ) {
    const reason = this.requiredReason(input.reason);
    return this.prisma.$transaction(async (tx) => {
      const [version, policy] = await Promise.all([
        tx.contractVersion.findUnique({ where: { id: contractVersionId } }),
        tx.contractEndedApplicationRetentionPolicy.findUnique({
          where: { id: ENDED_RETENTION_POLICY_ID }
        })
      ]);
      this.assertRetainedEndedApplication(version);
      await this.assertCanManageRetention(tx, version, actorUserId);
      if (!policy) {
        throw new ConflictException("结束申请保留策略尚未初始化，拒绝解除保留");
      }
      const hold = await tx.contractEndedApplicationRetentionHold.findFirst({
        where: { contractVersionId, releasedAt: null },
        orderBy: { createdAt: "desc" }
      });
      if (!hold) {
        throw new BadRequestException("当前结束申请不存在可解除的保留标记");
      }
      const released = await tx.contractEndedApplicationRetentionHold.updateMany({
        where: { id: hold.id, releasedAt: null },
        data: {
          releasedAt: now,
          releasedByUserId: actorUserId,
          releaseReason: reason
        }
      });
      if (released.count !== 1) {
        throw new ConflictException("保留标记已被其他操作更新，请刷新后重试");
      }
      const terminalAt = version.endedAt ?? policy.activatedAt;
      const retentionEndsAt = addCalendarMonths(terminalAt, RETENTION_MONTHS);
      const releaseBufferUntil = now.getTime() >= retentionEndsAt.getTime()
        ? addDays(now, PREVIEW_WINDOW_DAYS)
        : null;
      const purgeEligibleAt = releaseBufferUntil && releaseBufferUntil > retentionEndsAt
        ? releaseBufferUntil
        : retentionEndsAt;
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.ended_retention.hold.release",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: {
          reason,
          holdId: hold.id,
          retentionEndsAt: retentionEndsAt.toISOString(),
          releaseBufferUntil: toIso(releaseBufferUntil),
          purgeEligibleAt: purgeEligibleAt.toISOString()
        }
      });
      return {
        contractVersionId,
        holdReleased: true,
        retentionEndsAt: retentionEndsAt.toISOString(),
        releaseBufferUntil: toIso(releaseBufferUntil),
        purgeEligibleAt: purgeEligibleAt.toISOString()
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private requiredReason(value: string) {
    const reason = value?.trim() ?? "";
    if (!reason) throw new BadRequestException("结束申请保留操作必须填写原因");
    return reason;
  }

  private page(value: string | number | undefined) {
    const parsed = typeof value === "number" ? value : Number(value ?? 1);
    return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, 100_000) : 1;
  }

  private limit(value: string | number | undefined) {
    const parsed = typeof value === "number" ? value : Number(value ?? 50);
    return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, 100) : 50;
  }

  private async retentionProjectIds(actorUserId: string) {
    const projects = await this.prisma.project.findMany({ select: { id: true } });
    const projectIds = projects.map((project) => project.id);
    if (!projectIds.length) return [];
    const roleKeysByProject = await this.projectVisibility.effectiveRoleKeysByProject(
      actorUserId,
      projectIds
    );
    return projectIds.filter((projectId) =>
      roleKeysByProject.get(projectId)?.includes("contract_director")
    );
  }

  private async assertCanManageRetention(
    tx: Pick<Prisma.TransactionClient, "contract">,
    version: EndedVersion,
    actorUserId: string
  ) {
    const contract = await tx.contract.findUnique({
      where: { id: version.contractId },
      select: { projectId: true }
    });
    if (!contract) {
      throw new BadRequestException("结束申请所属合同不存在，拒绝维护保留标记");
    }
    const roleKeysByProject = await this.projectVisibility.effectiveRoleKeysByProject(
      actorUserId,
      [contract.projectId]
    );
    if (!roleKeysByProject.get(contract.projectId)?.includes("contract_director")) {
      throw new ForbiddenException("仅全局合同部主管或该合同项目范围内的合同部主管可维护保留标记");
    }
  }

  private assertRetainedEndedApplication(
    version: EndedVersion | null
  ): asserts version is EndedVersion {
    if (!version || !isRetainedEndedApplication(version)) {
      throw new BadRequestException("仅已放弃或最终驳回的合同申请可以设置保留");
    }
  }
}
