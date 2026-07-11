export interface ApprovalSelfReviewFormValue {
  selfReviewReason: string;
  confirmationPassword: string;
}

export interface ApprovalSelfReviewPayload {
  selfReviewReason?: string;
  confirmationPassword?: string;
}

export function buildApprovalSelfReviewPayload(
  requiresSelfReviewConfirmation: boolean,
  form: ApprovalSelfReviewFormValue
): ApprovalSelfReviewPayload {
  if (!requiresSelfReviewConfirmation) return {};

  const selfReviewReason = form.selfReviewReason.trim();
  if (!selfReviewReason) throw new Error("请填写自审原因");
  if (unicodeCodePointLength(selfReviewReason) > 500) {
    throw new Error("自审原因不能超过 500 字");
  }
  if (!form.confirmationPassword.trim()) throw new Error("请输入当前密码");
  if (unicodeCodePointLength(form.confirmationPassword) > 256) {
    throw new Error("当前密码不能超过 256 字");
  }

  return {
    selfReviewReason,
    confirmationPassword: form.confirmationPassword
  };
}

function unicodeCodePointLength(value: string): number {
  return Array.from(value).length;
}
