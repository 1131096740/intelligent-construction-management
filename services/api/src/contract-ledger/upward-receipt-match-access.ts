import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ProjectVisibilityService } from "../auth/project-visibility.service";

export async function requireUpwardReceiptFinance(tx:Prisma.TransactionClient,visibility:ProjectVisibilityService,
  actor:string,projectId:string,confirm=false) {
  if(!(await visibility.visibleProjectIdsInTransaction(tx,actor)).includes(projectId))throw new ForbiddenException("无权核对该项目到账");
  const roles=(await visibility.effectiveRoleKeysByProjectInTransaction(tx,actor,[projectId])).get(projectId)??[];
  if(!roles.some(role=>role==="finance_director" || (!confirm&&role==="finance_staff")))throw new ForbiddenException("到账核销由项目财务办理");
  return roles;
}

export async function canConfirmUpwardReceipt(tx:Prisma.TransactionClient,visibility:ProjectVisibilityService,actor:string,
  row:{projectId:string;status:string;recordedByUserId:string}) {
  if(row.status!=="pending_confirm"||row.recordedByUserId===actor)return false;
  try {await requireUpwardReceiptFinance(tx,visibility,actor,row.projectId,true);return true;}
  catch(error){if(error instanceof ForbiddenException)return false;throw error;}
}
