import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../database/prisma.service";
import { currentFundCompanyRoles } from "../fund-account/fund-account-duty";
import {
  PRINCIPAL_RETURN_BUSINESS_TYPE,
  PRINCIPAL_RETURN_REVIEW_ACTION,
  resolvePrincipalReturnReviewIdentity,
} from "../fund-account/fund-principal-return.service";
import type { FrozenApprovalNode } from "./approval-review-identity";
import type { CreateApprovalDelegationDto } from "./dto/create-approval-delegation.dto";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "./parallel-approval-protocol";

type Tx = Prisma.TransactionClient;

export async function loadPrincipalReturnDelegationDuty(tx: Tx, actorId: string, resourceId: string, direct = true) {
  const coordinates = /^([^:]+):(\d+)$/.exec(resourceId);
  if (!coordinates || typeof tx.approvalInstance?.findUnique !== "function") return null;
  const [, roundId, slot] = coordinates;
  const index = Number(slot);
  const round = await tx.approvalInstance.findUnique({ where: { id: roundId } });
  if (round?.businessType !== PRINCIPAL_RETURN_BUSINESS_TYPE) return null;
  if (resourceId !== `${roundId}:${index}` || round.status !== "approval_pending" ||
      !isParallelApprovalRound(round.frozenNodes) || !activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex).includes(index)) {
    throw new ForbiddenException("该本金归还审批职责已结束或不匹配");
  }
  const application = await tx.registeredPrincipalReturnApplication.findUnique({ where: { approvalInstanceId: roundId } });
  if (!application || application.id !== round.businessId || application.status !== "pending") {
    throw new ForbiddenException("本金归还审批记录已变化");
  }
  const node = round.frozenNodes[index] as FrozenApprovalNode;
  const review = await resolvePrincipalReturnReviewIdentity(tx, actorId, application.projectId, roundId, index, node, direct);
  if (!review || (direct && review.identity.viaAssignment) || (!direct && application.createdByUserId === actorId && review.identity.viaAssignment)) {
    throw new ForbiddenException("当前账号无权办理此本金归还职责");
  }
  return {
    applicationId: application.id,
    label: `${application.contributorName} · ${typeof node.name === "string" ? node.name : "本金归还审批"}`,
    actionKey: PRINCIPAL_RETURN_REVIEW_ACTION,
    resourceType: PRINCIPAL_RETURN_BUSINESS_TYPE,
    resourceId,
  } as const;
}

export async function principalReturnDelegationOptions(tx: Tx, actorId: string) {
  if (!tx.registeredPrincipalReturnApplication?.findMany) return [];
  const rounds = await tx.approvalInstance.findMany({
    where: { businessType: PRINCIPAL_RETURN_BUSINESS_TYPE, status: "approval_pending" },
    orderBy: { createdAt: "desc" },
  });
  const options = [];
  for (const round of rounds) {
    for (const index of activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex)) {
      try {
        const duty = await loadPrincipalReturnDelegationDuty(tx, actorId, `${round.id}:${index}`);
        if (duty) options.push({ value: duty.resourceId, label: duty.label, actionKey: duty.actionKey, resourceType: duty.resourceType });
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
  }
  return options;
}

export async function createPrincipalReturnDelegation(prisma: PrismaService, audit: AuditService, actorId: string, input: CreateApprovalDelegationDto) {
  const { resourceId, toUserId } = input;
  const roundId = resourceId && /^([^:]+):\d+$/.exec(resourceId)?.[1];
  if (input.actionKey !== PRINCIPAL_RETURN_REVIEW_ACTION || !resourceId || !roundId || !toUserId || toUserId === actorId) {
    throw new BadRequestException("请选择本金归还的具体职责及其他办理人");
  }
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !(endsAt > startsAt && endsAt > new Date())) {
    throw new BadRequestException("请填写有效且尚未结束的委托起止时间");
  }
  return prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM public."ApprovalInstance" WHERE id = ${roundId} FOR UPDATE`);
    const duty = await loadPrincipalReturnDelegationDuty(tx, actorId, resourceId);
    if (!duty) throw new ForbiddenException("归还审批职责不存在");
    const target = await tx.user.findUnique({ where: { id: toUserId }, select: { isActive: true } });
    if (!target?.isActive) throw new BadRequestException("委托接收人不存在或已停用");
    const targetRoles = await currentFundCompanyRoles(tx, toUserId);
    if (targetRoles.length === 1 && targetRoles[0] === "super_admin") throw new BadRequestException("技术管理员不能办理业务审批");
    const row = await tx.approvalDelegation.create({ data: {
      fromUserId: actorId, toUserId, startsAt, endsAt,
      actionKey: duty.actionKey, resourceType: duty.resourceType, resourceId,
    } });
    await audit.record(tx, {
      actorUserId: actorId, action: "approval.delegation.create", businessType: "approval_delegation",
      businessId: row.id, metadata: { toUserId, resourceId, actionKey: duty.actionKey, resourceType: duty.resourceType, dutyLabel: duty.label,
        startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    });
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
