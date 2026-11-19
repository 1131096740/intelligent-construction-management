import { isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import type { ProjectVisibilityService } from "../auth/project-visibility.service";
import { companyRepaymentApprovals } from "./company-transfer-repayment-approval";
import type { Prisma } from "@prisma/client";
import type { WorkItem } from "../me/me.service";
import { companyTransferRoles } from "./company-transfer.access";
import { resolveApprovalReviewIdentity } from "../approval/approval-review-identity";
import type { RoleKey } from "@jiangkong/shared-domain";
export async function companyTransferWorkItems(tx: Prisma.TransactionClient, actor: string, visibility: ProjectVisibilityService): Promise<WorkItem[]> {
  const roles = await companyTransferRoles(tx, actor);
  const projectRoles = await tx.$queryRaw<Array<{ projectId: string; roleKey: string }>>`SELECT DISTINCT up."projectId", p.key AS "roleKey" FROM "UserPosition" up JOIN "Position" p ON p.id=up."positionId" JOIN "User" u ON u.id=up."userId" WHERE u."isActive"=TRUE AND up."userId"=${actor} AND up."projectId" IS NOT NULL AND p.key IN ('finance_staff','finance_director','project_manager') UNION SELECT pm."projectId", pm."positionKey" AS "roleKey" FROM "ProjectMember" pm JOIN "User" u ON u.id=pm."userId" WHERE u."isActive"=TRUE AND pm."userId"=${actor} AND pm."positionKey" IN ('finance_staff','finance_director','project_manager')`;
  const financialProjects = new Set(projectRoles.filter(r => r.roleKey !== "project_manager").map(r => r.projectId));
  if (!projectRoles.length && !roles.some(r => ["comprehensive_director", "finance_staff", "finance_director", "chairman", "general_manager"].includes(r))) return [];
  const rows = await tx.companyTransfer.findMany({ where: { status: { in: ["submitted", "approved"] } } }), items: WorkItem[] = [];
  for (const r of rows) {
    const approval = await tx.approvalInstance.findUnique({ where: { id: r.approvalInstanceId! } });
    const parallel = r.requiresParallelRepaymentApproval;
    const reviewer = !parallel && r.status === "submitted" && r.applicantUserId !== actor && approval &&
      resolveApprovalReviewIdentity({ node: (approval.frozenNodes as Prisma.JsonArray)[0] as object, actorUserId: actor, actorRoleKeys: roles as RoleKey[] });
    const amountText = `${r.amountCents / 100n}.${(r.amountCents % 100n).toString().padStart(2, "0")} 元`;
    const path = `/公司互转台账?transferId=${encodeURIComponent(r.id)}`;
    if (parallel && r.status === "submitted" && approval?.status === "in_progress" && r.sourceProjectId && isParallelApprovalRound(approval.frozenNodes)) {
      for (const duty of await companyRepaymentApprovals(tx, visibility, actor, r.sourceProjectId, r.applicantUserId, approval.frozenNodes, approval.currentNodeIndex)) {
        const nodeName = String(approval.frozenNodes[duty.nodeIndex].name);
        items.push({ id: `company_transfer:${r.id}:${duty.nodeIndex}`, type: "approval", businessType: "company_transfer",
          businessId: r.id, businessCode: r.code, title: "公司代付款归还审批", projectId: r.sourceProjectId,
          projectName: "项目资金", amountText, currentNode: nodeName, stayedText: `申请于 ${r.createdAt.toISOString().slice(0, 10)}`,
          nextAction: "核对原代付、双方和付款依据", targetPath: path, tone: "warning" });
      }
      continue;
    }
    const finance = roles.some(k => ["finance_staff", "finance_director"].includes(k)) ||
      [r.sourceProjectId, r.destinationProjectId].every(p => !!p && financialProjects.has(p));
    const comprehensive = parallel && roles.includes("comprehensive_director") && !!r.sourceProjectId &&
      (await visibility.visibleProjectIdsInTransaction(tx, actor)).includes(r.sourceProjectId);
    if (!reviewer && !(r.status === "approved" && (finance || comprehensive))) continue;
    const events = await tx.companyTransferEvent.findMany({ where: { transferId: r.id } }); const sent = events.filter(e => e.kind === "outgoing").reduce((a, e) => a + e.amountCents, 0n), settled = events.filter(e => e.kind !== "outgoing").reduce((a, e) => a + e.amountCents, 0n); if (!reviewer && sent === r.amountCents && (!finance || settled === sent)) continue;
    items.push({ id: `company_transfer:${r.id}`, type: "approval", businessType: "company_transfer", businessId: r.id, businessCode: r.code, title: reviewer ? "公司互转终审" : "公司互转收付核对", projectId: r.sourceProjectId ?? undefined, projectName: r.sourceProjectId ? "项目资金" : "公司自有资金", amountText: `${r.amountCents / 100n}.${(r.amountCents % 100n).toString().padStart(2, "0")} 元`, currentNode: reviewer ? "董事长或总经理终审" : "财务执行及独立到账核对", stayedText: `申请于 ${r.createdAt.toISOString().slice(0, 10)}`, nextAction: reviewer ? "核对双方、资金归属及依据后终审" : "核对实际出款、到账及在途", targetPath: parallel ? path : "/公司互转台账", tone: "warning" });
  }
  if (roles.includes("finance_director")) for (const r of await tx.contractBankVerificationRequest.findMany({ where: { projectId: null, status: "pending_confirm", recordedByUserId: { not: actor } } })) items.push({ id: `contract_bank_verification:${r.id}`, type: "approval", businessType: "contract_bank_verification", businessId: r.id, businessCode: r.bankReference, title: "自有资金银行流水独立核验", projectName: "公司自有资金", amountText: "详见核验依据", currentNode: "财务负责人核验", stayedText: `登记于 ${r.createdAt.toISOString().slice(0, 10)}`, nextAction: "核验真实开户公司和完整账号", targetPath: "/公司互转台账", tone: "warning" });
  return items;
}
