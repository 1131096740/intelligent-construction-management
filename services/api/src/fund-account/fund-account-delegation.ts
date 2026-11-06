import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PrismaService } from "../database/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { CreateApprovalDelegationDto } from "../approval/dto/create-approval-delegation.dto";
import { currentFundCompanyRoles, FUND_REVIEW_ACTION, FUND_REVIEW_BUSINESS_TYPE, FUND_REVIEW_RESOURCE, fundReviewDutyId, loadFundReviewDuty, resolveFundReviewIdentity } from "./fund-account-duty";

export async function isFundReviewDuty(client: Prisma.TransactionClient | PrismaService, resourceId: string) {
  if (typeof client.approvalInstance?.findUnique !== "function") return false;
  const id = /^([^:]+):0$/.exec(resourceId)?.[1];
  if (!id) return false;
  const round = await client.approvalInstance.findUnique({ where: { id } });
  return round?.businessType === FUND_REVIEW_BUSINESS_TYPE;
}
export async function fundReviewDelegationCapability(tx: Prisma.TransactionClient, actor: string, resourceId: string) {
  const duty = await loadFundReviewDuty(tx, resourceId);
  return resolveFundReviewIdentity(tx, duty.row.id, actor, duty.round.id, true);
}
export async function createFundReviewDelegation(prisma: PrismaService, audit: AuditService, fromUserId: string, input: CreateApprovalDelegationDto) {
  if (input.actionKey !== FUND_REVIEW_ACTION || input.resourceType !== FUND_REVIEW_RESOURCE || !input.resourceId || !input.toUserId || input.toUserId === fromUserId) throw new BadRequestException("请选择本轮资金复核职责和另一名启用办理人");
  const startsAt = new Date(input.startsAt); const endsAt = new Date(input.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt || endsAt <= new Date()) throw new BadRequestException("请填写有效且尚未结束的委托起止时间");
  return prisma.$transaction(async tx => {
    const roundId = /^([^:]+):0$/.exec(input.resourceId!)?.[1];
    if (!roundId) throw new BadRequestException("请选择明确的资金复核职责");
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${roundId} FOR UPDATE`);
    const duty = await fundReviewDelegationCapability(tx, fromUserId, input.resourceId!);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${input.toUserId} FOR SHARE`);
    const target = await tx.user.findUnique({ where: { id: input.toUserId }, select: { isActive: true } });
    if (!target?.isActive) throw new BadRequestException("委托接收人不存在或已停用");
    const targetRoles = await currentFundCompanyRoles(tx, input.toUserId);
    if (targetRoles.includes("super_admin") && targetRoles.every(role => role === "super_admin")) throw new BadRequestException("技术管理员不能作为业务复核办理人");
    const row = await tx.approvalDelegation.create({ data: { fromUserId, toUserId: input.toUserId, startsAt, endsAt, actionKey: FUND_REVIEW_ACTION, resourceType: FUND_REVIEW_RESOURCE, resourceId: fundReviewDutyId(duty.round.id) } });
    await audit.record(tx, { actorUserId: fromUserId, action: "approval.delegation.create", businessType: "approval_delegation", businessId: row.id, metadata: { toUserId: input.toUserId, actionKey: FUND_REVIEW_ACTION, resourceType: FUND_REVIEW_RESOURCE, resourceId: fundReviewDutyId(duty.round.id), dutyLabel: duty.label, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() } });
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function fundReviewDutyOptions(tx: Prisma.TransactionClient, actor: string) {
  const rounds = await tx.approvalInstance.findMany({ where: { businessType: FUND_REVIEW_BUSINESS_TYPE, status: "approval_pending" }, orderBy: { createdAt: "desc" } });
  const result: Array<{ value: string; label: string; actionKey: typeof FUND_REVIEW_ACTION; resourceType: string }> = [];
  for (const round of rounds) {
    try { const duty = await fundReviewDelegationCapability(tx, actor, fundReviewDutyId(round.id)); result.push({ value: fundReviewDutyId(round.id), label: duty.label, actionKey: FUND_REVIEW_ACTION, resourceType: FUND_REVIEW_RESOURCE }); }
    catch (error) { if (!(error instanceof ForbiddenException) && !(error instanceof ConflictException)) throw error; }
  }
  return result;
}
