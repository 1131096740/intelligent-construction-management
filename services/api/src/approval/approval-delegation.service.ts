import { Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import { CreateApprovalDelegationDto } from "./dto/create-approval-delegation.dto";

type ApprovalDelegationClient = Pick<Prisma.TransactionClient, "approvalDelegation">;
@Injectable()
export class ApprovalDelegationService {
  constructor(
    @Optional()
    private readonly prisma?: PrismaService,
    @Optional()
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly projectVisibility?: ProjectVisibilityService
  ) {}

  async create(fromUserId: string, input: CreateApprovalDelegationDto) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to create approval delegation");
    }

    if (!input.toUserId || input.toUserId === fromUserId) {
      throw new Error("请选择需要委托的审批接收人，不能委托给自己");
    }

    const sameProjectUserIds = await this.sameProjectUserIds(fromUserId);
    if (!sameProjectUserIds.includes(input.toUserId)) {
      throw new Error("只能委托给同项目可协作人员，请重新选择接收人");
    }

    const targetUser = await this.prisma.user.findFirst({
      where: { id: input.toUserId, isActive: true },
      select: { id: true }
    });
    if (!targetUser) {
      throw new Error("委托接收人不存在或已停用，请重新选择");
    }

    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new Error("委托有效期不正确，请重新选择开始和结束时间");
    }

    if (endsAt <= startsAt) {
      throw new Error("委托结束时间必须晚于开始时间");
    }

    const delegation = await this.prisma.approvalDelegation.create({
      data: { fromUserId, toUserId: input.toUserId, startsAt, endsAt }
    });

    await this.audit.record(this.prisma, {
      actorUserId: fromUserId,
      action: "approval.delegation.create",
      businessType: "approval_delegation",
      businessId: delegation.id,
      metadata: {
        toUserId: input.toUserId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString()
      }
    });

    return delegation;
  }

  async listForUser(userId: string) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to list approval delegations");
    }

    const delegations = await this.prisma.approvalDelegation.findMany({
      where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
      orderBy: { createdAt: "desc" }
    });
    const userIds = [
      ...new Set(delegations.flatMap((delegation) => [delegation.fromUserId, delegation.toUserId]))
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true }
        })
      : [];
    const nameById = new Map(users.map((user) => [user.id, user.name]));

    return delegations.map((delegation) => ({
      ...delegation,
      fromUserName: nameById.get(delegation.fromUserId) ?? "委托人未读取",
      toUserName: nameById.get(delegation.toUserId) ?? "受托人未读取"
    }));
  }

  async listActiveUserOptions(userId: string) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to list active users");
    }

    const sameProjectUserIds = await this.sameProjectUserIds(userId);
    return this.prisma.user.findMany({
      where: { id: { in: sameProjectUserIds, not: userId }, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true }
    });
  }

  async revoke(id: string, actorUserId: string) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to revoke approval delegation");
    }

    const delegation = await this.prisma.approvalDelegation.findUnique({ where: { id } });

    if (!delegation) {
      throw new Error("审批委托记录不存在或已被删除");
    }

    if (delegation.fromUserId !== actorUserId) {
      throw new Error("只有委托发起人可以撤销这条审批委托");
    }

    if (!delegation.enabled) {
      throw new Error("这条审批委托已撤销，无需重复操作");
    }

    const updated = await this.prisma.approvalDelegation.update({
      where: { id },
      data: { enabled: false }
    });

    await this.audit.record(this.prisma, {
      actorUserId,
      action: "approval.delegation.revoke",
      businessType: "approval_delegation",
      businessId: id,
      metadata: { toUserId: delegation.toUserId }
    });

    return updated;
  }

  // 供合同/结算/付款审批 review 在事务内调用：返回当前时点对该被委托人有效的委托人 id。
  async activeDelegatorIds(
    client: ApprovalDelegationClient,
    toUserId: string,
    now: Date = new Date()
  ): Promise<string[]> {
    const rows = await client.approvalDelegation.findMany({
      where: {
        toUserId,
        enabled: true,
        startsAt: { lte: now },
        endsAt: { gte: now }
      }
    });

    return Array.from(new Set(rows.map((row) => row.fromUserId)));
  }

  private async sameProjectUserIds(userId: string): Promise<string[]> {
    if (!this.prisma) return [];
    const projectIds = await this.visibleProjectIds(userId);
    if (!projectIds.length) return [];

    const [positionRows, memberRows] = await Promise.all([
      this.prisma.userPosition.findMany({
        where: { projectId: { in: projectIds } },
        select: { userId: true }
      }),
      this.prisma.projectMember.findMany({
        where: { projectId: { in: projectIds } },
        select: { userId: true }
      })
    ]);

    return Array.from(new Set([...positionRows, ...memberRows].map((row) => row.userId)));
  }

  private visibleProjectIds(userId: string): Promise<string[]> {
    if (!this.projectVisibility) {
      throw new Error("Project visibility service is required to scope approval delegation");
    }
    return this.projectVisibility.visibleProjectIds(userId);
  }
}
