import { ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { activeScopedApprovalDelegatorIds } from "../approval/active-approval-delegations";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { resolveApprovalReviewIdentity, type FrozenApprovalNode } from "../approval/approval-review-identity";

export const FUND_REVIEW_ACTION = "fund_account.balance.review" as const;
export const FUND_REVIEW_RESOURCE = "fund_account_balance_review_duty";
export const FUND_REVIEW_BUSINESS_TYPE = "fund_account_balance_registration";
export const fundReviewDutyId = (roundId: string) => `${roundId}:0`;
export const fundReviewNodes = () => [{ name: "财务主管余额核对复核", mode: "any", roleKeys: ["finance_director"], approvedRoleKeys: [] as string[], protocolVersion: 1, executionMode: "parallel", roleScopesByRole: { finance_director: "global" } }];

export async function currentFundCompanyRoles(tx: Prisma.TransactionClient, userId: string): Promise<RoleKey[]> {
  try { return await new CompanyRoleResolverService(tx as never).resolveActiveRoleScopesInTransaction(tx, userId); }
  catch { return []; }
}
export async function assertFundReviewerAvailable(tx: Prisma.TransactionClient) {
  const positions = await tx.position.findMany({ where: { key: "finance_director" }, select: { id: true } });
  const assignments = await tx.userPosition.findMany({ where: { projectId: null, positionId: { in: positions.map(position => position.id) } }, select: { userId: true } });
  const users = await tx.user.findMany({ where: { id: { in: assignments.map(row => row.userId) }, isActive: true }, select: { id: true } });
  if (!users.length) throw new ConflictException("当前缺少有效公司级财务主管，不能跳过复核，请先安排职责人员");
}

/** This is a bounded adapter for one company-level fund duty, reusing the
 * established protocol and identity resolver. It grants no account-list access. */
export async function loadFundReviewDuty(tx: Prisma.TransactionClient, resourceId: string) {
  const match = /^([^:]+):0$/.exec(resourceId);
  if (!match) throw new ForbiddenException("资金复核职责选择无效，请刷新后重试");
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${match[1]} FOR UPDATE`);
  const round = await tx.approvalInstance.findUnique({ where: { id: match[1] } });
  if (!round || round.businessType !== FUND_REVIEW_BUSINESS_TYPE || round.flowType !== "fund_account_balance_correction" || round.status !== "approval_pending" || !isParallelApprovalRound(round.frozenNodes) || round.frozenNodes.length !== 1 || !activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex).includes(0)) throw new ForbiddenException("该资金复核职责已结束或不匹配，请刷新后重试");
  const node = round.frozenNodes[0];
  if (node.mode !== "any" || JSON.stringify(node.roleKeys) !== '["finance_director"]') throw new ForbiddenException("资金复核职责配置异常，不能跳岗办理");
  const row = await tx.fundAccountBalanceRegistration.findUnique({ where: { id: round.businessId }, include: { sources: true } });
  if (!row || row.kind !== "correction" || row.status !== "pending_review" || row.approvalInstanceId !== round.id || round.applicantUserId !== row.createdByUserId) throw new ForbiddenException("资金复核轮次已变化或不匹配");
  const current = await tx.fundAccountBalanceRegistration.findMany({ where: { accountId: row.accountId, status: "confirmed" }, orderBy: { version: "desc" } });
  if (current[0]?.id !== row.previousRegistrationId) throw new ConflictException("原有效余额已变化，请重新核对登记");
  const account = await tx.registeredFundAccount.findUnique({ where: { id: row.accountId } });
  if (!account) throw new ForbiddenException("资金账户不存在，不能办理复核");
  const company = account.companyEntityId ? await tx.companyEntity.findUnique({ where: { id: account.companyEntityId } }) : null;
  return { round, row, account, node, label: `${company?.name ?? "公共现金"} · 余额核对更正 · 财务主管复核` };
}
export async function resolveFundReviewIdentity(tx: Prisma.TransactionClient, registrationId: string, actorUserId: string, expectedRoundId?: string, directHolderOnly = false) {
  const row = await tx.fundAccountBalanceRegistration.findUnique({ where: { id: registrationId } });
  if (!row?.approvalInstanceId || (expectedRoundId !== undefined && row.approvalInstanceId !== expectedRoundId)) throw new ConflictException("资金复核轮次已变化，请刷新后重试");
  const duty = await loadFundReviewDuty(tx, fundReviewDutyId(row.approvalInstanceId));
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${actorUserId} FOR SHARE`);
  await tx.$queryRaw(Prisma.sql`SELECT up."userId" FROM "UserPosition" up INNER JOIN "Position" p ON p."id" = up."positionId" WHERE up."userId" = ${actorUserId} AND up."projectId" IS NULL FOR SHARE OF up, p`);
  const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } });
  if (!actor?.isActive) throw new ForbiddenException("当前办理账号已停用");
  const actorRoles = await currentFundCompanyRoles(tx, actorUserId);
  if (actorRoles.includes("super_admin") && actorRoles.every(role => role === "super_admin")) throw new ForbiddenException("技术管理员不能办理业务复核");
  const scope = { actionKey: FUND_REVIEW_ACTION, resourceType: FUND_REVIEW_RESOURCE, resourceId: fundReviewDutyId(duty.round.id) };
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalDelegation" WHERE "toUserId" = ${actorUserId} AND "actionKey" = ${FUND_REVIEW_ACTION} AND "resourceType" = ${FUND_REVIEW_RESOURCE} AND "resourceId" = ${scope.resourceId} FOR SHARE`);
  const ids = directHolderOnly ? [] : await activeScopedApprovalDelegatorIds(tx, actorUserId, scope);
  const activeDelegators = [];
  for (const userId of ids) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR SHARE`);
    await tx.$queryRaw(Prisma.sql`SELECT up."userId" FROM "UserPosition" up INNER JOIN "Position" p ON p."id" = up."positionId" WHERE up."userId" = ${userId} AND up."projectId" IS NULL FOR SHARE OF up, p`);
    const roles = await currentFundCompanyRoles(tx, userId); activeDelegators.push({ userId, roleKeys: roles, roleScopes: { globalRoleKeys: roles, projectRoleKeys: [] } }); }
  const identity = resolveApprovalReviewIdentity({ node: duty.node as FrozenApprovalNode, actorUserId, actorRoleKeys: actorRoles, actorRoleScopes: { globalRoleKeys: actorRoles, projectRoleKeys: [] }, activeDelegators });
  if (!identity || identity.approvedRoleKey !== "finance_director" || (directHolderOnly && identity.representedUserId !== actorUserId)) throw new ForbiddenException("当前账号不是该轮资金复核职责的有效处理人");
  const mandates = identity.representedUserId !== actorUserId ? await tx.approvalDelegation.findMany({ where: { ...scope, fromUserId: identity.representedUserId, toUserId: actorUserId, enabled: true, startsAt: { lte: new Date() }, endsAt: { gt: new Date() } }, orderBy: { createdAt: "asc" } }) : [];
  if (identity.representedUserId !== actorUserId && !mandates[0]) throw new ForbiddenException("该资金复核委托已失效，请刷新后重试");
  return { ...duty, identity, actorRoles, delegationId: mandates[0]?.id ?? null, delegationEndsAt: mandates[0]?.endsAt ?? null };
}
