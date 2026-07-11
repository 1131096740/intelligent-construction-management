import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException
} from "@nestjs/common";
import type { RoleKey } from "@jiangkong/shared-domain";

const SELF_REVIEW_BUSINESS_ROLES = new Set<RoleKey>(["chairman", "general_manager"]);

export interface ApprovalSelfReviewInput {
  applicantUserId: string;
  actorUserId: string;
  actorRoleKeys: readonly RoleKey[];
}

export interface ConfirmApprovalSelfReviewInput extends ApprovalSelfReviewInput {
  selfReviewReason?: string;
  confirmationPassword?: string;
  confirmPassword?: (password: string) => Promise<unknown>;
}

export type ApprovalSelfReviewResult =
  | { isSelfReview: false; metadata: Record<string, never> }
  | {
      isSelfReview: true;
      metadata: { selfReview: true; selfReviewReason: string };
    };

export function assertOrdinaryApplicantCannotReview(input: ApprovalSelfReviewInput): void {
  if (input.applicantUserId !== input.actorUserId) return;
  if (input.actorRoleKeys.some((role) => SELF_REVIEW_BUSINESS_ROLES.has(role))) return;
  throw new ForbiddenException("申请人不能审批自己发起的业务，请由其他有权限的审批人处理");
}

export async function confirmApprovalSelfReview(
  input: ConfirmApprovalSelfReviewInput
): Promise<ApprovalSelfReviewResult> {
  assertOrdinaryApplicantCannotReview(input);
  if (input.applicantUserId !== input.actorUserId) {
    return { isSelfReview: false, metadata: {} };
  }

  const selfReviewReason = input.selfReviewReason?.trim();
  if (!selfReviewReason) {
    throw new BadRequestException("董事长或总经理审批自己发起的业务时，请填写自审原因");
  }

  const confirmationPassword = input.confirmationPassword?.trim();
  if (!confirmationPassword) {
    throw new BadRequestException("董事长或总经理自审前，请输入当前密码完成二次确认");
  }
  if (!input.confirmPassword) {
    throw new ServiceUnavailableException("审批身份确认服务暂不可用，请稍后重试");
  }

  await input.confirmPassword(confirmationPassword);
  return {
    isSelfReview: true,
    metadata: { selfReview: true, selfReviewReason }
  };
}
