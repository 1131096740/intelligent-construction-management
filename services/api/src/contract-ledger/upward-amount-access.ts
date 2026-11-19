import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ProjectVisibilityService } from "../auth/project-visibility.service";

export async function upwardAmountRoles(tx:Prisma.TransactionClient,visibility:ProjectVisibilityService,actor:string,projectId:string) {
  if (!(await visibility.visibleProjectIdsInTransaction(tx,actor)).includes(projectId)) {
    throw new ForbiddenException("无权办理本项目对上金额修订");
  }
  return (await visibility.effectiveRoleKeysByProjectInTransaction(tx,actor,[projectId])).get(projectId)??[];
}

export async function canReviewUpwardAmount(tx:Prisma.TransactionClient,visibility:ProjectVisibilityService,actor:string,
  revision:{projectId:string;recordedByUserId:string;status:string}) {
  if (revision.status!=="pending_confirm" || revision.recordedByUserId===actor) return false;
  try {
    return (await upwardAmountRoles(tx,visibility,actor,revision.projectId)).includes("contract_director");
  } catch(error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}
