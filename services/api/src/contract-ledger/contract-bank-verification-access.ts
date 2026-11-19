import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ProjectVisibilityService } from "../auth/project-visibility.service";
import { companyTransferRoles } from "../company-transfer/company-transfer.access";

export async function assertBankVerificationProjectFinance(tx: Prisma.TransactionClient, visibility: ProjectVisibilityService,
  actor: string, projectId: string) {
  if (!(await visibility.visibleProjectIdsInTransaction(tx,actor)).includes(projectId)) {
    throw new ForbiddenException("无权核验本项目银行流水");
  }
  const roles=(await visibility.effectiveRoleKeysByProjectInTransaction(tx,actor,[projectId])).get(projectId)??[];
  if (!roles.some(role=>role==="finance_staff" || role==="finance_director")) {
    throw new ForbiddenException("银行流水由所属项目财务岗位办理");
  }
}

export async function canReviewPendingBankVerification(tx: Prisma.TransactionClient, visibility: ProjectVisibilityService,
  recipientId: string, row: {status:string;projectId:string|null;recordedByUserId:string}) {
  if (row.status !== "pending_confirm" || row.recordedByUserId === recipientId ||
      !(await companyTransferRoles(tx,recipientId)).includes("finance_director")) return false;
  if (!row.projectId) return true;
  try { await assertBankVerificationProjectFinance(tx,visibility,recipientId,row.projectId); return true; }
  catch(error) { if (error instanceof ForbiddenException) return false; throw error; }
}
