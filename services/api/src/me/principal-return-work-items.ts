import { type Prisma } from "@prisma/client";
import type { FrozenApprovalNode } from "../approval/approval-review-identity";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import type { PrismaService } from "../database/prisma.service";
import { RegisteredBalanceDecimal } from "../payment/registered-payment-funding";
import {
  PRINCIPAL_RETURN_BUSINESS_TYPE,
  principalReturnPayableScopeKeys,
  resolvePrincipalReturnReviewIdentity,
} from "../fund-account/fund-principal-return.service";
import type { WorkItem } from "./me.service";

export async function principalReturnWorkItems(
  prisma: PrismaService, actorId: string, mode: "pending" | "started" | "delegated",
): Promise<WorkItem[]> {
  if (!prisma.registeredPrincipalReturnApplication?.findMany) return [];
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { isActive: true } });
    if (!actor?.isActive) return [];
    const rows = await tx.registeredPrincipalReturnApplication.findMany({
      where: {
        status: { in: mode === "pending" ? ["pending", "approved", "partially_paid"] : ["pending"] },
        ...(mode === "started" ? { createdByUserId: actorId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    const hasOutstanding = mode === "pending" && rows.some(row =>
      (row.status === "approved" || row.status === "partially_paid") && row.approvedYuan?.gt(row.paidYuan));
    const payable = hasOutstanding && (await principalReturnPayableScopeKeys(tx, actorId)).length > 0;
    const [rounds, projects] = await Promise.all([
      tx.approvalInstance.findMany({
        where: { id: { in: rows.filter(row => row.status === "pending").map(row => row.approvalInstanceId) },
          status: "approval_pending", businessType: PRINCIPAL_RETURN_BUSINESS_TYPE },
      }),
      tx.project.findMany({
        where: { id: { in: rows.flatMap(row => row.projectId ? [row.projectId] : []) } },
        select: { id: true, name: true },
      }),
    ]);
    const roundsById = new Map(rounds.map(round => [round.id, round]));
    const projectNames = new Map(projects.map(project => [project.id, project.name]));
    const items: WorkItem[] = [];
    for (const row of rows) {
      const base = {
        businessId: row.id,
        businessType: PRINCIPAL_RETURN_BUSINESS_TYPE,
        projectId: row.projectId ?? undefined,
        projectName: row.projectId ? projectNames.get(row.projectId) ?? "关联项目" : "公司日常",
        businessCode: "垫资本金归还",
        title: `${row.contributorName} · 垫资本金归还`,
        stayedText: "",
        targetPath: `/垫资本金归还/${encodeURIComponent(row.id)}`,
      };
      if (row.status !== "pending") {
        if (!payable || !row.approvedYuan?.gt(row.paidYuan)) continue;
        const remainingYuan = new RegisteredBalanceDecimal(row.approvedYuan.toFixed(4))
          .minus(row.paidYuan.toFixed(4)).toFixed(4);
        items.push({ ...base, id: `principal-return-pay:${row.id}`, type: "payment_execution",
          amountText: `待归还 ¥${remainingYuan}`,
          currentNode: "登记实际归还", nextAction: "登记实付", tone: "warning",
        });
        continue;
      }
      const round = roundsById.get(row.approvalInstanceId);
      if (!round || round.businessId !== row.id || !isParallelApprovalRound(round.frozenNodes)) continue;
      const approval = { ...base, amountText: `¥${row.requestedYuan.toFixed(4)}`, type: "approval" } as const;
      if (mode === "started") {
        items.push({ ...approval, id: `principal-return-started:${round.id}`,
          currentNode: "并联审批", nextAction: "查看审批进度", tone: "primary" });
        continue;
      }
      for (const index of activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex)) {
        const node = round.frozenNodes[index] as FrozenApprovalNode;
        const review = await resolvePrincipalReturnReviewIdentity(tx, actorId, row.projectId, round.id, index, node);
        if (!review || (row.createdByUserId === actorId && review.identity.viaAssignment) ||
            (mode === "delegated" && !review.identity.viaAssignment)) continue;
        items.push({ ...approval, id: `principal-return-review:${round.id}:${index}`,
          currentNode: typeof node.name === "string" ? node.name : "本金归还审批", nextAction: "处理当前审批", tone: "warning" });
      }
    }
    return items;
  });
}
