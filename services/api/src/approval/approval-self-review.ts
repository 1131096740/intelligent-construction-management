import { ForbiddenException } from "@nestjs/common";
import type { RoleKey } from "@jiangkong/shared-domain";

const SELF_REVIEW_BUSINESS_ROLES = new Set<RoleKey>(["chairman", "general_manager"]);

export interface ApprovalSelfReviewInput {
  applicantUserId: string;
  actorUserId: string;
  actorRoleKeys: readonly RoleKey[];
}

export function assertOrdinaryApplicantCannotReview(input: ApprovalSelfReviewInput): void {
  if (input.applicantUserId !== input.actorUserId) return;
  if (input.actorRoleKeys.some((role) => SELF_REVIEW_BUSINESS_ROLES.has(role))) return;
  throw new ForbiddenException("申请人不能审批自己发起的业务，请由其他有权限的审批人处理");
}
