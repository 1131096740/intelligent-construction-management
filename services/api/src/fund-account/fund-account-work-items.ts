import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service";
import type { WorkItem } from "../me/me.service";
import { FUND_REVIEW_BUSINESS_TYPE, fundReviewDutyId, fundReviewerAvailable, loadFundReviewDuty, resolveFundReviewIdentity } from "./fund-account-duty";

/** Current duty projection only. No task records or balance mutations. */
export async function fundReviewWorkItems(prisma: PrismaService, userId: string, mode: "pending" | "started" | "delegated" = "pending"): Promise<WorkItem[]> {
  if (!prisma.fundAccountBalanceRegistration?.findMany) return [];
  return prisma.$transaction(async tx => {
    const rows = await tx.fundAccountBalanceRegistration.findMany({ where: { kind: "correction", status: "pending_review", ...(mode === "started" ? { createdByUserId: userId } : {}) }, orderBy: { createdAt: "desc" } });
    const items: WorkItem[] = [];
    for (const row of rows) {
      try {
        if (!row.approvalInstanceId) continue;
        const duty = mode === "started" ? await loadFundReviewDuty(tx, fundReviewDutyId(row.approvalInstanceId)) : await resolveFundReviewIdentity(tx, row.id, userId, row.approvalInstanceId);
        if (mode === "delegated" && (!("delegationId" in duty) || !duty.delegationId)) continue;
        const company = duty.account.companyEntityId ? await tx.companyEntity.findUnique({ where: { id: duty.account.companyEntityId }, select: { name: true } }) : null;
        const waiting = mode === "started" && !(await fundReviewerAvailable(tx));
        items.push({ id: `fund-review:${duty.round.id}`, type: "approval", businessType: FUND_REVIEW_BUSINESS_TYPE, businessId: row.id,
          title: `${company?.name ?? "公共现金"}余额核对更正`, projectName: duty.account.kind === "public_cash" ? "公共现金" : "公司登记余额", businessCode: "余额核对更正",
          amountText: row.balanceYuan === null ? "余额待核对" : `核对余额 ¥${row.balanceYuan.toFixed(4)}`, currentNode: waiting ? "财务主管待配置" : "财务主管余额核对复核", stayedText: "",
          nextAction: mode === "started" ? "查看原单及复核状态" : "复核余额更正", targetPath: mode === "started" ? "/资金账户" : `/资金余额复核/${encodeURIComponent(row.id)}`, tone: mode === "started" ? "primary" : "warning" });
      } catch (error) { if (!(error instanceof ForbiddenException) && !(error instanceof ConflictException)) throw error; }
    }
    return items;
  });
}
