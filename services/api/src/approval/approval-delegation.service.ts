import { createFundReviewDelegation, fundReviewDelegationCapability, fundReviewDutyOptions, isFundReviewDuty } from "../fund-account/fund-account-delegation";
import { FUND_REVIEW_RESOURCE } from "../fund-account/fund-account-duty";
import {SpotProcurementApprovalNotificationService} from "../spot-procurement/spot-procurement-approval-notification.service";
import {Prisma} from "@prisma/client";
import {activeApprovalNodeIndexes, isParallelApprovalRound} from "./parallel-approval-protocol";
import {loadEffectiveProjectApprovalAssignments} from "./project-approval-assignments";
import {SPOT_APPROVAL_DUTY_RESOURCE} from "./spot-approval-duty-access";
import { BadRequestException, ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { BUSINESS_ACTIONS, type BusinessAction } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import {
  activeApprovalDelegatorIds,
  type ActiveApprovalDelegationClient
} from "./active-approval-delegations";
import { CreateApprovalDelegationDto } from "./dto/create-approval-delegation.dto";

@Injectable()
export class ApprovalDelegationService {
  constructor(
    @Optional()
    private readonly prisma?: PrismaService,
    @Optional()
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly projectVisibility?: ProjectVisibilityService,
    @Optional() private readonly notifications?: SpotProcurementApprovalNotificationService
  ) {}

  async create(fromUserId: string, input: CreateApprovalDelegationDto) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to create approval delegation");
    }

    if (input.resourceType === FUND_REVIEW_RESOURCE) return createFundReviewDelegation(this.prisma, this.audit, fromUserId, input);
    if (input.resourceType === SPOT_APPROVAL_DUTY_RESOURCE) return this.createDutyDelegation(fromUserId, input);
    const scope = delegationScope(input);
    // Retain the existing clearing creation contract; other historical consumers remain read-compatible.
    if (scope && !(scope.actionKey === "clearing.confirm" && scope.resourceType === "clearing_event")) {
      throw new BadRequestException("当前不支持该委托作用域，请选择具体的零星申请审批职责");
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

    if (!scope) throw new BadRequestException("请选择明确的审批职责，不能创建无范围委托");

    const delegation = await this.prisma.approvalDelegation.create({
      data: {
        fromUserId,
        toUserId: input.toUserId,
        startsAt,
        endsAt,
        ...(scope ?? {})
      }
    });

    await this.audit.record(this.prisma, {
      actorUserId: fromUserId,
      action: "approval.delegation.create",
      businessType: "approval_delegation",
      businessId: delegation.id,
      metadata: {
        toUserId: input.toUserId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        ...(scope ?? {})
      }
    });

    return delegation;
  }

  private async duty(tx: Prisma.TransactionClient, userId: string, resourceId: string, lock: boolean) {
    const match = /^([^:]+):(0|[1-9][0-9]*)$/.exec(resourceId);
    if (!match) throw new BadRequestException("请选择明确的审批职责");
    const index = Number(match[2]);
    if (lock) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${match[1]} FOR UPDATE`);
    const round = await tx.approvalInstance.findUnique({where: {id: match[1]}});
    if (!round || round.businessType !== "spot_procurement_version" || round.status !== "approval_pending" || !isParallelApprovalRound(round.frozenNodes) || !activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex).includes(index)) throw new ForbiddenException("该审批职责已结束或无权委托，请刷新后重试");
    const version = await tx.spotProcurementVersion.findUnique({where: {id: round.businessId}});
    const application = version ? await tx.spotProcurement.findUnique({where: {id: version.procurementId}}) : null;
    if (!application || application.currentVersionId !== round.businessId || application.status !== "approval_pending") throw new ForbiddenException("该审批职责已结束或无权委托，请刷新后重试");
    const node = round.frozenNodes[index];
    const assignments = await loadEffectiveProjectApprovalAssignments(tx, application.projectId, node.roleKeys as string[], userId);
    if (!assignments.some(row => row.userIsActive && row.userId === userId && row.projectId === application.projectId && (node.roleKeys as string[]).includes(row.roleKey))) throw new ForbiddenException("当前账号不是该职责的有效审批人");
    const project = await tx.project.findUnique({where: {id: application.projectId}, select: {name: true}});
    return {round, application, label: `${project?.name ?? "项目"} · ${application.code} · ${String(node.name)}`};
  }

  private async createDutyDelegation(fromUserId: string, input: CreateApprovalDelegationDto) {
    if (!this.prisma) throw new BadRequestException("委托服务暂不可用，请稍后重试");
    const scope = delegationScope(input);
    if (!scope || scope.actionKey !== "spot_procurement.approve" || !input.toUserId || input.toUserId === fromUserId) throw new BadRequestException("请选择明确的审批职责和其他启用接收人");
    const startsAt = new Date(input.startsAt); const endsAt = new Date(input.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt || endsAt <= new Date()) throw new BadRequestException("委托有效期不正确，请填写尚未结束的起止时间");
    const result = await this.prisma.$transaction(async tx => {
      const duty = await this.duty(tx, fromUserId, scope.resourceId, true);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${input.toUserId} FOR SHARE`);
      const target = await tx.user.findUnique({where: {id: input.toUserId}, select: {isActive: true}});
      if (!target?.isActive) throw new BadRequestException("委托接收人不存在或已停用，请重新选择");
      const delegation = await tx.approvalDelegation.create({data: {fromUserId, toUserId: input.toUserId, startsAt, endsAt, ...scope}});
      await this.notifications?.queueInTransaction(tx, duty.round, duty.application.projectId, duty.application.code);
      await this.audit.record(tx, {actorUserId: fromUserId, action: "approval.delegation.create", businessType: "approval_delegation", businessId: delegation.id,
        metadata: {...scope, toUserId: input.toUserId, dutyLabel: duty.label, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString()}});
      return delegation;
    });
    await this.notifications?.dispatchQueued().catch(() => undefined);
    return result;
  }

  async dutyCapability(userId: string, resourceId: string) {
    if (!this.prisma) return {canDelegate: false};
    if (await isFundReviewDuty(this.prisma, resourceId)) { await fundReviewDelegationCapability(this.prisma as never, userId, resourceId); return { canDelegate: true, actionKey: "fund_account.balance.review", resourceType: FUND_REVIEW_RESOURCE, resourceId }; }
    await this.duty(this.prisma as never, userId, resourceId, false);
    return {canDelegate: true, actionKey: "spot_procurement.approve", resourceType: SPOT_APPROVAL_DUTY_RESOURCE, resourceId};
  }

  async revokeCapability(userId: string, id: string) {
    const row = await this.prisma?.approvalDelegation.findUnique({where: {id}});
    return {canRevoke: Boolean(row && row.enabled && row.fromUserId === userId)};
  }

  async listDutyOptions(userId: string) {
    if (!this.prisma) return [];
    const rounds = await this.prisma.approvalInstance.findMany({where: {businessType: "spot_procurement_version", status: "approval_pending"}, orderBy: {createdAt: "desc"}});
    const result: Array<{value: string; label: string; actionKey?: string; resourceType?: string}> = await fundReviewDutyOptions(this.prisma as never, userId);
    for (const round of rounds) {
      if (!isParallelApprovalRound(round.frozenNodes)) continue;
      for (const index of activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex)) {
        const value = `${round.id}:${index}`;
        try { const duty = await this.duty(this.prisma as never, userId, value, false); result.push({value, label: duty.label, actionKey: "spot_procurement.approve", resourceType: SPOT_APPROVAL_DUTY_RESOURCE}); }
        catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
      }
    }
    return result;
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
    const scopedIds = delegations.filter(row => row.resourceType === SPOT_APPROVAL_DUTY_RESOURCE || row.resourceType === FUND_REVIEW_RESOURCE).map(row => row.id);
    const creationFacts = scopedIds.length ? await this.prisma.auditLog.findMany({where: {action: "approval.delegation.create", businessType: "approval_delegation", businessId: {in: scopedIds}}, orderBy: {createdAt: "asc"}, select: {businessId: true, metadata: true}}) : [];
    const labelById = new Map<string, string>();
    for (const fact of creationFacts) {
      const data = fact.metadata && typeof fact.metadata === "object" && !Array.isArray(fact.metadata) ? fact.metadata : {};
      if (fact.businessId && typeof data.dutyLabel === "string" && !labelById.has(fact.businessId)) labelById.set(fact.businessId, data.dutyLabel);
    }


    const reviewPathById = new Map<string, string>();
    for (const delegation of delegations) {
      if (delegation.resourceType !== FUND_REVIEW_RESOURCE || delegation.toUserId !== userId || !delegation.resourceId) continue;
      try {
        const { resolveFundReviewIdentity } = await import("../fund-account/fund-account-duty");
        const roundId = delegation.resourceId.replace(/:0$/, "");
        const round = await this.prisma.approvalInstance.findUnique({ where: { id: roundId } });
        if (!round) continue;
        await resolveFundReviewIdentity(this.prisma as never, round.businessId, userId, round.id);
        reviewPathById.set(delegation.id, `/资金余额复核/${encodeURIComponent(round.businessId)}`);
      } catch { /* Expired, closed or revoked duties convey no entry. */ }
    }
    return delegations.map((delegation) => ({
      ...delegation,
      ...(reviewPathById.has(delegation.id) ? {reviewPath: reviewPathById.get(delegation.id)} : {}),
      ...(labelById.has(delegation.id) ? {scopeLabel: labelById.get(delegation.id)} : {}),
      fromUserName: nameById.get(delegation.fromUserId) ?? "委托人未读取",
      toUserName: nameById.get(delegation.toUserId) ?? "受托人未读取"
    }));
  }

  async listActiveUserOptions(userId: string, dutyId?: string) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to list active users");
    }

    if (dutyId) {
      if (await isFundReviewDuty(this.prisma, dutyId)) {
        await fundReviewDelegationCapability(this.prisma as never, userId, dutyId);
        return this.prisma.user.findMany({ where: { isActive: true, id: { not: userId } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
      }
      await this.duty(this.prisma as never, userId, dutyId, false);
      return this.prisma.user.findMany({where: {isActive: true, id: {not: userId}}, orderBy: {name: "asc"}, select: {id: true, name: true}});
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

    if (delegation.resourceType === SPOT_APPROVAL_DUTY_RESOURCE || delegation.resourceType === FUND_REVIEW_RESOURCE) {
      return this.prisma.$transaction(async tx => {
        const instanceId = delegation.resourceId?.split(":")[0];
        if (instanceId) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${instanceId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalDelegation" WHERE "id" = ${id} FOR UPDATE`);
        const current = await tx.approvalDelegation.findUnique({ where: { id } });
        if (!current || current.fromUserId !== actorUserId) throw new ForbiddenException("只有委托发起人可以撤销这条审批委托");
        if (!current.enabled) throw new BadRequestException("这条审批委托已撤销，无需重复操作");
        const updated = await tx.approvalDelegation.update({ where: { id }, data: { enabled: false } });
        await this.audit.record(tx, { actorUserId, action: "approval.delegation.revoke", businessType: "approval_delegation", businessId: id, metadata: { toUserId: current.toUserId, actionKey: current.actionKey, resourceType: current.resourceType, resourceId: current.resourceId } });
        return updated;
      });
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
    client: ActiveApprovalDelegationClient,
    toUserId: string,
    now: Date = new Date()
  ): Promise<string[]> {
    return activeApprovalDelegatorIds(client, toUserId, now);
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

function delegationScope(input: CreateApprovalDelegationDto) {
  const values = [input.actionKey, input.resourceType, input.resourceId];
  if (values.every((value) => value === undefined)) return null;
  if (values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("委托作用域必须同时包含动作、资源类型和资源标识");
  }
  const actionKey = input.actionKey as BusinessAction;
  const resourceType = input.resourceType!.trim();
  const resourceId = input.resourceId!.trim();
  if (!BUSINESS_ACTIONS.includes(actionKey)) {
    throw new Error("委托动作不在受支持的业务权限清单中");
  }
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(resourceType) || resourceId.length > 200) {
    throw new Error("委托资源作用域不合法");
  }
  return { actionKey, resourceType, resourceId };
}
