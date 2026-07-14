export interface SensitiveActionConfirmationValues {
  requireReason: boolean;
  reason: string;
  requirePassword: boolean;
  password: string;
}

export function sensitiveActionConfirmationError(values: SensitiveActionConfirmationValues) {
  if (values.requireReason && !values.reason.trim()) {
    return "请填写操作原因";
  }
  if (values.requirePassword && !values.password.trim()) {
    return "请输入当前登录密码";
  }
  return "";
}
