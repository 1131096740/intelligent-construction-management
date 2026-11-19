import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ProjectVisibilityService } from "../auth/project-visibility.service";

export async function requireProxyFinance(tx:Prisma.TransactionClient,visibility:ProjectVisibilityService,
  actor:string,projectId:string,confirm=false) {
  if (!(await visibility.visibleProjectIdsInTransaction(tx,actor)).includes(projectId)) throw new ForbiddenException("无权办理该项目代付");
  const roles=(await visibility.effectiveRoleKeysByProjectInTransaction(tx,actor,[projectId])).get(projectId)??[];
  if (!roles.some(role=>role==="finance_director" || (!confirm && role==="finance_staff"))) {
    throw new ForbiddenException("该动作须由所属项目财务岗位办理");
  }
  return roles;
}

export async function canConfirmProxyPending(tx:Prisma.TransactionClient,visibility:ProjectVisibilityService,actor:string,
  row:{projectId:string;status:string;recordedByUserId:string}) {
  if (row.status!=="pending_confirm" || row.recordedByUserId===actor) return false;
  try { await requireProxyFinance(tx,visibility,actor,row.projectId,true); return true; }
  catch(error) { if(error instanceof ForbiddenException)return false;throw error; }
}
