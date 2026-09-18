import { ConflictException, ForbiddenException } from "@nestjs/common";

export function assertExpenseClaimEntrySubmission(claim: { handledByUserId: string; approvalInstanceId: string | null; status: string }, actorUserId: string, approvalInstanceId: string) {
  if (claim.handledByUserId !== actorUserId) throw new ForbiddenException("只有经办人可以提交费用申请");
  if (claim.status !== "approval_pending" || claim.approvalInstanceId !== approvalInstanceId) throw new ConflictException("费用申请提交版本不一致，请刷新后重试");
}
