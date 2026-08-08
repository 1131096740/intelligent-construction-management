import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException
} from "@nestjs/common";
import type { RoleKey } from "@jiangkong/shared-domain";

const LEADER_SELF_REVIEW_BUSINESS_ROLES = new Set<RoleKey>(["chairman", "general_manager"]);

export interface ApprovalSelfReviewInput {
  applicantUserId: string;
  actorUserId: string;
  actorRoleKeys: readonly RoleKey[];
  approvedRoleKey: RoleKey;
  representedUserId?: string;
  viaAssignment?: boolean;
  allowContractDirectorSelfReview?: boolean;
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

export function requiresApprovalSelfReviewConfirmation(input: {
  applicantUserId: string;
  actorUserId: string;
  actorRoleKeys: readonly RoleKey[];
  nodeRoleKeys: readonly RoleKey[];
  allowContractDirectorSelfReview?: boolean;
}): boolean {
  if (input.applicantUserId !== input.actorUserId) return false;
  const approvedRoleKey = input.nodeRoleKeys.find((roleKey) =>
    input.actorRoleKeys.includes(roleKey)
  );
  return approvedRoleKey !== undefined && isAllowedSelfReviewRole(
    approvedRoleKey,
    input.allowContractDirectorSelfReview === true
  );
}

export function assertOrdinaryApplicantCannotReview(input: ApprovalSelfReviewInput): void {
  if (input.applicantUserId !== input.actorUserId) return;
  const resolvedDirectIdentity =
    input.representedUserId === input.actorUserId &&
    input.viaAssignment !== true &&
    input.actorRoleKeys.includes(input.approvedRoleKey);
  const legacyDirectIdentity =
    input.representedUserId === undefined && input.actorRoleKeys.includes(input.approvedRoleKey);
  if (
    isAllowedSelfReviewRole(
      input.approvedRoleKey,
      input.allowContractDirectorSelfReview === true
    ) &&
    (resolvedDirectIdentity || legacyDirectIdentity)
  ) {
    return;
  }
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
    throw new BadRequestException(
      `${selfReviewRoleLabel(input.approvedRoleKey)}审批自己发起的业务时，请填写自审原因`
    );
  }

  const confirmationPassword = input.confirmationPassword;
  if (!confirmationPassword?.trim()) {
    throw new BadRequestException(
      `${selfReviewRoleLabel(input.approvedRoleKey)}自审前，请输入当前密码完成二次确认`
    );
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

function isAllowedSelfReviewRole(
  roleKey: RoleKey,
  allowContractDirectorSelfReview: boolean
) {
  return LEADER_SELF_REVIEW_BUSINESS_ROLES.has(roleKey) ||
    (allowContractDirectorSelfReview && roleKey === "contract_director");
}

function selfReviewRoleLabel(roleKey: RoleKey) {
  if (LEADER_SELF_REVIEW_BUSINESS_ROLES.has(roleKey)) return "董事长或总经理";
  return "合同部主管";
}
