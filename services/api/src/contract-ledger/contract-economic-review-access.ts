import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ProjectVisibilityService } from "../auth/project-visibility.service";
import type { RoleKey } from "@jiangkong/shared-domain";

export const CONTRACT_ECONOMIC_REVIEW_PREPARER_ROLES: readonly RoleKey[] = [
  "contract_staff", "contract_director", "budget_staff", "budget_director"
];

export const CONTRACT_ECONOMIC_REVIEW_READER_ROLES: readonly RoleKey[] = [
  ...CONTRACT_ECONOMIC_REVIEW_PREPARER_ROLES,
  "finance_staff", "finance_director", "project_manager", "chairman", "general_manager"
];

export async function requireEconomicReviewRoles(tx: Prisma.TransactionClient, visibility: ProjectVisibilityService,
  actor: string, projectId: string, allowed: readonly RoleKey[]) {
  const visible = await visibility.visibleProjectIdsInTransaction(tx,actor);
  if(!visible.includes(projectId))throw new ForbiddenException("当前账号无权办理该项目履约复核");
  const roles=(await visibility.effectiveRoleKeysByProjectInTransaction(tx,actor,[projectId])).get(projectId)??[];
  if(!roles.some(role=>allowed.includes(role)))throw new ForbiddenException("当前岗位没有履约复核权限");
  return roles;
}

export async function canReviewEconomicFinance(tx: Prisma.TransactionClient, visibility: ProjectVisibilityService,
  actor: string, row: {projectId:string;status:string;financeRequired:boolean;preparedByUserId:string;contractReviewedById:string|null}) {
  if(row.status!=="pending_finance" || !row.financeRequired || !row.contractReviewedById ||
    row.preparedByUserId===actor || row.contractReviewedById===actor)return false;
  try {await requireEconomicReviewRoles(tx,visibility,actor,row.projectId,["finance_director"]);return true;}
  catch(error){if(error instanceof ForbiddenException)return false;throw error;}
}
