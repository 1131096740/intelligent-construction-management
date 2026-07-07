import { Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { CreateApprovalDelegationDto } from "./dto/create-approval-delegation.dto";

type ApprovalDelegationClient = Pick<Prisma.TransactionClient, "approvalDelegation">;

@Injectable()
export class ApprovalDelegationService {
  constructor(
    @Optional()
    private readonly prisma?: PrismaService,
    @Optional()
    private readonly audit: AuditService = new AuditService()
  ) {}

  async create(fromUserId: string, input: CreateApprovalDelegationDto) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to create approval delegation");
    }

    if (!input.toUserId || input.toUserId === fromUserId) {
      throw new Error("Approval delegation target is invalid");
    }

    const targetUser = await this.prisma.user.findFirst({
      where: { id: input.toUserId, isActive: true },
      select: { id: true }
    });
    if (!targetUser) {
      throw new Error("Approval delegation target user is inactive or not found");
    }

    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new Error("Approval delegation window is invalid");
    }

    if (endsAt <= startsAt) {
      throw new Error("Approval delegation must end after it starts");
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
      fromUserName: nameById.get(delegation.fromUserId) ?? delegation.fromUserId,
      toUserName: nameById.get(delegation.toUserId) ?? delegation.toUserId
    }));
  }

  async listActiveUserOptions() {
    if (!this.prisma) {
      throw new Error("Prisma service is required to list active users");
    }

    return this.prisma.user.findMany({
      where: { isActive: true },
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
      throw new Error("Approval delegation not found");
    }

    if (delegation.fromUserId !== actorUserId) {
      throw new Error("Only the delegator can revoke an approval delegation");
    }

    if (!delegation.enabled) {
      throw new Error("Approval delegation is already revoked");
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
}
