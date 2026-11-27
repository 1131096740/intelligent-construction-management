import { workItemNoticeAt } from "../me/work-item-notice-order";
import type { Prisma } from "@prisma/client";
import type { WorkItem } from "../me/me.service";
import type { ProjectVisibilityService } from "../auth/project-visibility.service";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";
import { companyTransferCashAccess, companyTransferRoles } from "./company-transfer.access";
import { companyTransferFinalReviewer, currentCompanyTransferCashDuties } from "./company-transfer.domain";
import { isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { companyTransferCorrectionDutyLabel, companyTransferCorrectionTarget, currentCompanyTransferCorrectionDuties } from "./company-transfer-correction-duty";
import { companyRepaymentApprovals } from "./company-transfer-repayment-approval";
export async function companyTransferWorkItems(tx: Prisma.TransactionClient, actor: string, visibility: ProjectVisibilityService): Promise<WorkItem[]> {
  const roles = await companyTransferRoles(tx, actor);
  const projectRoles = await tx.$queryRaw<Array<{ projectId: string; roleKey: string }>>`SELECT DISTINCT up."projectId", p.key AS "roleKey" FROM "UserPosition" up JOIN "Position" p ON p.id=up."positionId" JOIN "User" u ON u.id=up."userId" WHERE u."isActive"=TRUE AND up."userId"=${actor} AND up."projectId" IS NOT NULL AND p.key IN ('finance_staff','finance_director','project_manager') UNION SELECT pm."projectId", pm."positionKey" AS "roleKey" FROM "ProjectMember" pm JOIN "User" u ON u.id=pm."userId" WHERE u."isActive"=TRUE AND pm."userId"=${actor} AND pm."positionKey" IN ('finance_staff','finance_director','project_manager')`;
  if (!projectRoles.length && !roles.some(r => ["comprehensive_director", "finance_staff", "finance_director", "chairman", "general_manager"].includes(r))) return [];
  const rows = await tx.companyTransfer.findMany({ where: { status: { in: ["submitted", "approved"] } } }), items: WorkItem[] = [];
  for (const r of rows) {
    const parallel = r.requiresParallelRepaymentApproval;
    const path = `/公司互转台账?transferId=${encodeURIComponent(r.id)}`;
    if (parallel && r.status === "submitted") {
      const approval = r.approvalInstanceId ? await tx.approvalInstance.findUnique({where:{id:r.approvalInstanceId}}) : null;
    const amountText = `${r.amountCents / 100n}.${(r.amountCents % 100n).toString().padStart(2, "0")} 元`;
    if (approval?.status === "in_progress" && r.sourceProjectId && isParallelApprovalRound(approval.frozenNodes)) {
      for (const duty of await companyRepaymentApprovals(tx, visibility, actor, r.sourceProjectId, r.applicantUserId, approval.frozenNodes, approval.currentNodeIndex)) {
        const nodeName = String(approval.frozenNodes[duty.nodeIndex].name);
        items.push({ [workItemNoticeAt]:r.createdAt,id: `company_transfer:${r.id}:${duty.nodeIndex}`, type: "approval", businessType: "company_transfer",
          businessId: r.id, businessCode: r.code, title: "公司代付款归还审批", projectId: r.sourceProjectId,
          projectName: "项目资金", amountText, currentNode: nodeName, stayedText: `申请于 ${r.createdAt.toISOString().slice(0, 10)}`,
          nextAction: "核对原代付、双方和付款依据", targetPath: path, tone: "warning" });
      }
    }

      continue;
    }
    const comprehensiveOutgoing = parallel && roles.includes("comprehensive_director") && !!r.sourceProjectId &&
      (await visibility.visibleProjectIdsInTransaction(tx, actor)).includes(r.sourceProjectId);
    const base = {type:"approval" as const,businessType:"company_transfer",businessId:r.id,businessCode:r.code,
      projectId:r.sourceProjectId ?? undefined,projectName:r.sourceProjectId || r.destinationProjectId ? "项目资金" : "公司自有资金",
      stayedText:`申请于 ${r.createdAt.toISOString().slice(0,10)}`,targetPath:"/公司互转台账",tone:"warning" as const};
    if (r.status === "submitted" && r.approvalInstanceId) {
      const approval=await tx.approvalInstance.findUnique({where:{id:r.approvalInstanceId}});
      if (companyTransferFinalReviewer(r,approval,actor,roles)) items.push({...base,
        [workItemNoticeAt]:r.createdAt,id:`company_transfer:${r.id}`,title:"公司互转终审",
        amountText:`${formatMoneyCentsAsPlainYuan(r.amountCents)} 元`,
        currentNode:"董事长或总经理终审",nextAction:"核对双方、资金归属及依据后终审"});
    } else if (r.status === "approved") {
      const finance = await companyTransferCashAccess(tx,visibility,actor,[r.sourceProjectId,r.destinationProjectId],roles);
      if (!finance && !comprehensiveOutgoing) continue;
      const events=await tx.companyTransferEvent.findMany({where:{transferId:r.id},select:{
        id:true,kind:true,amountCents:true,outgoingEventId:true,returnedIncomingEventId:true,recordedByUserId:true,createdAt:true
      }});
      if (parallel && roles.includes("finance_director")) {
        for (const duty of await currentCompanyTransferCorrectionDuties(tx,r,events)) {
          items.push({...base,[workItemNoticeAt]:duty.requestedAt,id:`company_transfer_correction:${duty.event.id}`,
            title:companyTransferCorrectionDutyLabel,currentNode:companyTransferCorrectionDutyLabel,nextAction:companyTransferCorrectionDutyLabel,
            amountText:`${formatMoneyCentsAsPlainYuan(duty.event.amountCents)} 元`,targetPath:companyTransferCorrectionTarget(r.id,duty.event.id)});
        }
      }
      for (const duty of currentCompanyTransferCashDuties(r,events,actor)) {
        if (!finance && duty.key !== "outgoing") continue;
        items.push({...base,[workItemNoticeAt]:duty.createdAt,id:`company_transfer:${r.id}:${duty.key}`,
          ...(parallel ? {targetPath:path} : {}),title:duty.label,currentNode:duty.label,nextAction:duty.label,amountText:`${formatMoneyCentsAsPlainYuan(duty.amountCents)} 元`});
      }
    }
  }
  if (roles.includes("finance_director")) for (const r of await tx.contractBankVerificationRequest.findMany({ where: { projectId: null, status: "pending_confirm", recordedByUserId: { not: actor } } })) items.push({ [workItemNoticeAt]: r.createdAt, id: `contract_bank_verification:${r.id}`, type: "approval", businessType: "contract_bank_verification", businessId: r.id, businessCode: r.bankReference, title: "自有资金银行流水独立核验", projectName: "公司自有资金", amountText: "详见核验依据", currentNode: "财务负责人核验", stayedText: `登记于 ${r.createdAt.toISOString().slice(0, 10)}`, nextAction: "核验真实开户公司和完整账号", targetPath: "/公司互转台账", tone: "warning" });
  return items;
}
